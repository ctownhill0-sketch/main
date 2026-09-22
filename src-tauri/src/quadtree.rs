//! Adaptive quadtree tiling for Deep Search — beats Google's 60-result cap
//! per query by recursively subdividing any tile that hits the cap.
//!
//! The recursion/subdivision logic is decoupled from the network via the
//! `TileFetcher` trait so it can be unit-tested with synthetic, scripted
//! responses (no live API calls, no HTTP mocking needed).

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sqlx::SqlitePool;

use crate::places::{store, ClientError, LatLngLiteral, PlacesClient, Viewport, MAX_RESULTS_PER_QUERY};

#[derive(Debug, Clone)]
pub struct DeepSearchParams {
    pub max_depth: u32,
    /// Stop subdividing once a tile's larger side is smaller than this many
    /// degrees (~0.01deg is roughly 1km at the equator).
    pub min_tile_degrees: f64,
    /// Hard stop on total Search API calls for this run (the spec's
    /// per-run call cap guardrail), independent of the monthly spend cap
    /// PlacesClient enforces per-call.
    pub call_cap: u32,
}

impl Default for DeepSearchParams {
    fn default() -> Self {
        Self {
            max_depth: 6,
            min_tile_degrees: 0.01,
            call_cap: 200,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct DeepSearchProgress {
    pub tiles_scanned: u32,
    pub tiles_subdivided: u32,
    pub unique_places_found: u32,
    pub calls_made: u32,
    pub done: bool,
    pub cancelled: bool,
    pub call_cap_reached: bool,
}

#[derive(Debug, Clone, Default)]
pub struct DeepSearchOutcome {
    pub place_ids: Vec<String>,
    pub tiles_scanned: u32,
    pub tiles_subdivided: u32,
    pub calls_made: u32,
    pub cancelled: bool,
    pub call_cap_reached: bool,
}

pub struct TileFetchResult {
    pub place_ids: Vec<String>,
    /// How many Search API calls (pages) this tile's fetch made — used to
    /// track the per-run call cap and to derive estimated cost.
    pub calls_made: u32,
}

/// Fetches one tile's full result set (already paginated internally, up to
/// Google's 3-page/60-result cap) and reports how many calls that took.
/// The real implementation also persists each place and is the only thing
/// in this trait's implementors that touches the network or the database;
/// `run_deep_search` itself is pure orchestration.
pub trait TileFetcher {
    async fn fetch_tile(&mut self, tile: Viewport) -> Result<TileFetchResult, ClientError>;
}

/// The real `TileFetcher`: runs Text Search against one tile via
/// `PlacesClient`, paginating up to the 60-result cap, persisting every
/// discovered place (place_id kept indefinitely), and reporting how many
/// calls it made.
pub struct LiveTileFetcher<'a> {
    pub pool: &'a SqlitePool,
    pub client: &'a PlacesClient,
    pub api_key: &'a str,
    pub query: &'a str,
}

impl<'a> TileFetcher for LiveTileFetcher<'a> {
    async fn fetch_tile(&mut self, tile: Viewport) -> Result<TileFetchResult, ClientError> {
        let mut place_ids = Vec::new();
        let mut page_token: Option<String> = None;
        let mut calls_made = 0u32;
        let max_pages = MAX_RESULTS_PER_QUERY / crate::places::MAX_PAGE_SIZE;

        for page in 0..max_pages {
            if page > 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }

            let response = self
                .client
                .search_text(self.pool, self.api_key, self.query, Some(tile), None, page_token.as_deref())
                .await?;
            calls_made += 1;

            let got_results = !response.places.is_empty();
            for place in &response.places {
                if let Err(e) = store::upsert_discovered_place(self.pool, place).await {
                    eprintln!("failed to persist discovered place: {e}");
                    continue;
                }
                if let Some(id) = &place.id {
                    place_ids.push(id.clone());
                }
            }

            match response.next_page_token {
                Some(token) if got_results => page_token = Some(token),
                _ => break,
            }
        }

        Ok(TileFetchResult { place_ids, calls_made })
    }
}

pub fn split_into_quadrants(v: Viewport) -> [Viewport; 4] {
    let mid_lat = (v.low.latitude + v.high.latitude) / 2.0;
    let mid_lng = (v.low.longitude + v.high.longitude) / 2.0;
    [
        Viewport {
            low: LatLngLiteral { latitude: v.low.latitude, longitude: v.low.longitude },
            high: LatLngLiteral { latitude: mid_lat, longitude: mid_lng },
        },
        Viewport {
            low: LatLngLiteral { latitude: v.low.latitude, longitude: mid_lng },
            high: LatLngLiteral { latitude: mid_lat, longitude: v.high.longitude },
        },
        Viewport {
            low: LatLngLiteral { latitude: mid_lat, longitude: v.low.longitude },
            high: LatLngLiteral { latitude: v.high.latitude, longitude: mid_lng },
        },
        Viewport {
            low: LatLngLiteral { latitude: mid_lat, longitude: mid_lng },
            high: LatLngLiteral { latitude: v.high.latitude, longitude: v.high.longitude },
        },
    ]
}

pub fn tile_size_degrees(v: &Viewport) -> f64 {
    let lat_span = v.high.latitude - v.low.latitude;
    let lng_span = v.high.longitude - v.low.longitude;
    lat_span.max(lng_span)
}

const RESULT_CAP_PER_TILE: usize = 60;

pub async fn run_deep_search<F, P>(
    fetcher: &mut F,
    root: Viewport,
    params: DeepSearchParams,
    cancel: Arc<AtomicBool>,
    mut on_progress: P,
) -> Result<DeepSearchOutcome, ClientError>
where
    F: TileFetcher,
    P: FnMut(&DeepSearchProgress),
{
    let mut queue: Vec<(Viewport, u32)> = vec![(root, 0)];
    let mut found_ids: HashSet<String> = HashSet::new();
    let mut tiles_scanned = 0u32;
    let mut tiles_subdivided = 0u32;
    let mut calls_made = 0u32;

    while let Some((tile, depth)) = queue.pop() {
        if cancel.load(Ordering::Relaxed) {
            let progress = DeepSearchProgress {
                tiles_scanned,
                tiles_subdivided,
                unique_places_found: found_ids.len() as u32,
                calls_made,
                done: true,
                cancelled: true,
                call_cap_reached: false,
            };
            on_progress(&progress);
            return Ok(DeepSearchOutcome {
                place_ids: found_ids.into_iter().collect(),
                tiles_scanned,
                tiles_subdivided,
                calls_made,
                cancelled: true,
                call_cap_reached: false,
            });
        }

        if calls_made >= params.call_cap {
            let progress = DeepSearchProgress {
                tiles_scanned,
                tiles_subdivided,
                unique_places_found: found_ids.len() as u32,
                calls_made,
                done: true,
                cancelled: false,
                call_cap_reached: true,
            };
            on_progress(&progress);
            return Ok(DeepSearchOutcome {
                place_ids: found_ids.into_iter().collect(),
                tiles_scanned,
                tiles_subdivided,
                calls_made,
                cancelled: false,
                call_cap_reached: true,
            });
        }

        let result = fetcher.fetch_tile(tile).await?;
        calls_made += result.calls_made;
        tiles_scanned += 1;

        let hit_cap = result.place_ids.len() >= RESULT_CAP_PER_TILE;
        for id in result.place_ids {
            found_ids.insert(id);
        }

        let can_subdivide =
            tile_size_degrees(&tile) > params.min_tile_degrees && depth < params.max_depth;

        if hit_cap && can_subdivide {
            tiles_subdivided += 1;
            for child in split_into_quadrants(tile) {
                queue.push((child, depth + 1));
            }
        }

        on_progress(&DeepSearchProgress {
            tiles_scanned,
            tiles_subdivided,
            unique_places_found: found_ids.len() as u32,
            calls_made,
            done: false,
            cancelled: false,
            call_cap_reached: false,
        });
    }

    let progress = DeepSearchProgress {
        tiles_scanned,
        tiles_subdivided,
        unique_places_found: found_ids.len() as u32,
        calls_made,
        done: true,
        cancelled: false,
        call_cap_reached: false,
    };
    on_progress(&progress);

    Ok(DeepSearchOutcome {
        place_ids: found_ids.into_iter().collect(),
        tiles_scanned,
        tiles_subdivided,
        calls_made,
        cancelled: false,
        call_cap_reached: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    fn austin_viewport() -> Viewport {
        Viewport {
            low: LatLngLiteral { latitude: 30.0, longitude: -98.0 },
            high: LatLngLiteral { latitude: 30.5, longitude: -97.5 },
        }
    }

    #[test]
    fn splitting_a_tile_produces_four_non_overlapping_quadrants_covering_the_original() {
        let v = austin_viewport();
        let quads = split_into_quadrants(v);

        // Every quadrant's bounds must lie within the original tile.
        for q in &quads {
            assert!(q.low.latitude >= v.low.latitude && q.high.latitude <= v.high.latitude);
            assert!(q.low.longitude >= v.low.longitude && q.high.longitude <= v.high.longitude);
        }

        // The four quadrants must jointly span the full original tile.
        let min_lat = quads.iter().map(|q| q.low.latitude).fold(f64::MAX, f64::min);
        let max_lat = quads.iter().map(|q| q.high.latitude).fold(f64::MIN, f64::max);
        let min_lng = quads.iter().map(|q| q.low.longitude).fold(f64::MAX, f64::min);
        let max_lng = quads.iter().map(|q| q.high.longitude).fold(f64::MIN, f64::max);
        assert!((min_lat - v.low.latitude).abs() < 1e-9);
        assert!((max_lat - v.high.latitude).abs() < 1e-9);
        assert!((min_lng - v.low.longitude).abs() < 1e-9);
        assert!((max_lng - v.high.longitude).abs() < 1e-9);
    }

    #[test]
    fn tile_size_is_the_larger_of_lat_and_lng_span() {
        let v = Viewport {
            low: LatLngLiteral { latitude: 0.0, longitude: 0.0 },
            high: LatLngLiteral { latitude: 0.02, longitude: 0.05 },
        };
        assert!((tile_size_degrees(&v) - 0.05).abs() < 1e-12);
    }

    /// A scripted fetcher: returns a fixed number of synthetic place IDs
    /// per call, in the order tiles are requested (depth-first, since the
    /// real algorithm uses a stack). Lets tests assert exactly which tiles
    /// got subdivided without any network or database access.
    struct ScriptedFetcher {
        responses: VecDeque<Vec<String>>,
        calls: Vec<Viewport>,
    }

    impl TileFetcher for ScriptedFetcher {
        async fn fetch_tile(&mut self, tile: Viewport) -> Result<TileFetchResult, ClientError> {
            self.calls.push(tile);
            let ids = self.responses.pop_front().unwrap_or_default();
            Ok(TileFetchResult { place_ids: ids, calls_made: 1 })
        }
    }

    fn ids(n: usize, prefix: &str) -> Vec<String> {
        (0..n).map(|i| format!("{prefix}-{i}")).collect()
    }

    #[tokio::test]
    async fn a_tile_under_the_cap_is_not_subdivided() {
        let mut fetcher = ScriptedFetcher {
            responses: VecDeque::from([ids(12, "a")]),
            calls: vec![],
        };
        let outcome = run_deep_search(
            &mut fetcher,
            austin_viewport(),
            DeepSearchParams::default(),
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .await
        .unwrap();

        assert_eq!(outcome.tiles_scanned, 1);
        assert_eq!(outcome.tiles_subdivided, 0);
        assert_eq!(outcome.place_ids.len(), 12);
        assert_eq!(fetcher.calls.len(), 1);
    }

    #[tokio::test]
    async fn a_tile_at_the_cap_is_subdivided_into_exactly_four_children() {
        // Root hits the 60 cap; all four children come back under it.
        let mut fetcher = ScriptedFetcher {
            responses: VecDeque::from([
                ids(60, "root"),
                ids(5, "c1"),
                ids(5, "c2"),
                ids(5, "c3"),
                ids(5, "c4"),
            ]),
            calls: vec![],
        };
        let outcome = run_deep_search(
            &mut fetcher,
            austin_viewport(),
            DeepSearchParams::default(),
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .await
        .unwrap();

        assert_eq!(outcome.tiles_scanned, 5, "root + 4 children");
        assert_eq!(outcome.tiles_subdivided, 1, "only the root hit the cap");
        // 60 root ids (all unique) + 4*5 child ids, all unique => 80 total.
        assert_eq!(outcome.place_ids.len(), 80);
    }

    #[tokio::test]
    async fn duplicate_place_ids_across_tiles_are_deduped() {
        let mut fetcher = ScriptedFetcher {
            responses: VecDeque::from([
                ids(60, "root"),
                // Every child rediscovers "root-0" plus one new id each.
                vec!["root-0".to_string(), "c1-new".to_string()],
                vec!["root-0".to_string(), "c2-new".to_string()],
                vec!["root-0".to_string(), "c3-new".to_string()],
                vec!["root-0".to_string(), "c4-new".to_string()],
            ]),
            calls: vec![],
        };
        let outcome = run_deep_search(
            &mut fetcher,
            austin_viewport(),
            DeepSearchParams::default(),
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .await
        .unwrap();

        // 59 unique root ids + root-0 (shared) + 4 new child ids = 64.
        assert_eq!(outcome.place_ids.len(), 64);
    }

    #[tokio::test]
    async fn recursion_stops_at_max_depth_even_if_every_tile_hits_the_cap() {
        // Always return 60 ids, forcing subdivision every time — the depth
        // limit must still terminate the search.
        let mut responses = VecDeque::new();
        // Root (depth 0) + enough tiles to cover depth 0..=2 fully (1+4+16=21)
        // when max_depth is capped at 2, so it doesn't run forever.
        for i in 0..25 {
            responses.push_back(ids(60, &format!("t{i}")));
        }
        let mut fetcher = ScriptedFetcher { responses, calls: vec![] };

        let params = DeepSearchParams { max_depth: 2, min_tile_degrees: 0.0, call_cap: 1000 };
        let outcome = run_deep_search(
            &mut fetcher,
            austin_viewport(),
            params,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .await
        .unwrap();

        // depth 0: 1 tile, depth 1: 4 tiles, depth 2: 16 tiles (not subdivided further) = 21.
        assert_eq!(outcome.tiles_scanned, 21);
    }

    #[tokio::test]
    async fn the_call_cap_stops_the_search_early_and_is_reported() {
        let mut responses = VecDeque::new();
        for i in 0..25 {
            responses.push_back(ids(60, &format!("t{i}")));
        }
        let mut fetcher = ScriptedFetcher { responses, calls: vec![] };

        let params = DeepSearchParams { max_depth: 10, min_tile_degrees: 0.0, call_cap: 3 };
        let outcome = run_deep_search(
            &mut fetcher,
            austin_viewport(),
            params,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .await
        .unwrap();

        assert!(outcome.call_cap_reached);
        assert!(outcome.calls_made >= 3);
        assert!(outcome.tiles_scanned <= 3);
    }

    #[tokio::test]
    async fn cancelling_stops_the_search_and_is_reported() {
        let mut responses = VecDeque::new();
        for i in 0..25 {
            responses.push_back(ids(60, &format!("t{i}")));
        }
        let mut fetcher = ScriptedFetcher { responses, calls: vec![] };
        let cancel = Arc::new(AtomicBool::new(false));

        let mut tiles_seen = 0;
        let cancel_clone = cancel.clone();
        let params = DeepSearchParams { max_depth: 10, min_tile_degrees: 0.0, call_cap: 1000 };
        let outcome = run_deep_search(&mut fetcher, austin_viewport(), params, cancel.clone(), |p| {
            tiles_seen += 1;
            if p.tiles_scanned >= 2 {
                cancel_clone.store(true, Ordering::Relaxed);
            }
        })
        .await
        .unwrap();

        assert!(outcome.cancelled);
        assert!(outcome.tiles_scanned <= 3);
        let _ = tiles_seen;
    }
}
