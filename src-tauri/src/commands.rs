//! The `#[tauri::command]` surface exposed to the frontend. Kept thin —
//! real logic lives in the modules these commands call into.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::db::AppDb;
use crate::places::{self, PlaceRow, PlacesClient};
use crate::quadtree::{self, DeepSearchParams, DeepSearchProgress};
use crate::{geocoding, keychain};

/// Cancellation flags for in-flight Deep Search runs, keyed by a run ID the
/// frontend generates. Managed as Tauri state.
#[derive(Default)]
pub struct DeepSearchRegistry(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

#[tauri::command]
pub fn has_api_key() -> Result<bool, String> {
    keychain::get_api_key()
        .map(|k| k.is_some())
        .map_err(|e| e.to_string())
}

/// Validates the given key against the Geocoding API (one cheap call) and,
/// only if valid, stores it in the OS keychain. Returns a user-facing error
/// message on either a bad key or a network failure.
#[tauri::command]
pub async fn validate_and_store_api_key(key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("API key cannot be empty.".to_string());
    }

    let result = geocoding::validate_api_key(trimmed)
        .await
        .map_err(|e| format!("Couldn't reach Google to validate the key: {e}"))?;

    if !result.valid {
        return Err(format!(
            "That key was rejected by Google ({}). Check that it's correct and that the \
             Geocoding API and Places API are enabled for it.",
            result.detail
        ));
    }

    keychain::set_api_key(trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_api_key() -> Result<(), String> {
    keychain::delete_api_key().map_err(|e| e.to_string())
}

/// Quick Search: a single Text Search query, paginated up to Google's hard
/// cap of 60 results (3 pages of 20), always using `MASK_DISCOVERY`.
/// Persists every discovered place (place_id kept indefinitely) and
/// returns the freshly-upserted rows for immediate display.
#[tauri::command]
pub async fn quick_search(
    db: tauri::State<'_, AppDb>,
    client: tauri::State<'_, PlacesClient>,
    query: String,
    rank_preference: Option<String>,
) -> Result<Vec<PlaceRow>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Enter a search query, e.g. \"coffee shops in Austin, TX\".".to_string());
    }

    let api_key = keychain::get_api_key()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No API key configured. Add one in Settings.".to_string())?;

    let rank = match rank_preference.as_deref() {
        Some("DISTANCE") => Some(places::RankPreference::Distance),
        Some("RELEVANCE") => Some(places::RankPreference::Relevance),
        _ => None,
    };

    let mut collected_ids: Vec<String> = Vec::new();
    let mut page_token: Option<String> = None;
    let max_pages = places::MAX_RESULTS_PER_QUERY / places::MAX_PAGE_SIZE;

    for page in 0..max_pages {
        if page > 0 {
            // Google needs a short delay before a fresh nextPageToken is valid.
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        let response = client
            .search_text(&db.0, &api_key, query, None, rank, page_token.as_deref())
            .await
            .map_err(|e| e.to_string())?;

        let got_results = !response.places.is_empty();
        for place in &response.places {
            if let Err(e) = places::store::upsert_discovered_place(&db.0, place).await {
                eprintln!("failed to persist discovered place: {e}");
                continue;
            }
            if let Some(id) = &place.id {
                collected_ids.push(id.clone());
            }
        }

        match response.next_page_token {
            Some(token) if got_results => page_token = Some(token),
            _ => break,
        }
    }

    places::store::get_places(&db.0, &collected_ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_places(db: tauri::State<'_, AppDb>) -> Result<Vec<PlaceRow>, String> {
    places::store::list_recent_places(&db.0, 500)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeepSearchProgressEvent {
    run_id: String,
    tiles_scanned: u32,
    tiles_subdivided: u32,
    unique_places_found: u32,
    calls_made: u32,
    estimated_cost_usd: f64,
    done: bool,
    cancelled: bool,
    call_cap_reached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSearchSummary {
    place_ids: Vec<String>,
    tiles_scanned: u32,
    tiles_subdivided: u32,
    calls_made: u32,
    estimated_cost_usd: f64,
    cancelled: bool,
    call_cap_reached: bool,
    area_formatted_address: String,
}

fn estimated_search_cost_usd(calls_made: u32) -> f64 {
    places::cost::Tier::SearchPro.cost_per_call_usd() * calls_made as f64
}

/// Deep Search: geocodes `location` to a viewport, then adaptively
/// subdivides it (see quadtree.rs) to beat Google's 60-result-per-query
/// cap. Emits `deep-search-progress` events as it goes and can be stopped
/// early via `cancel_deep_search` or the per-run call cap.
#[tauri::command]
pub async fn start_deep_search(
    app: AppHandle,
    db: tauri::State<'_, AppDb>,
    client: tauri::State<'_, PlacesClient>,
    registry: tauri::State<'_, DeepSearchRegistry>,
    run_id: String,
    query: String,
    location: String,
    max_depth: Option<u32>,
    call_cap: Option<u32>,
) -> Result<DeepSearchSummary, String> {
    let query = query.trim().to_string();
    let location = location.trim().to_string();
    if query.is_empty() {
        return Err("Enter a business type/keyword to search for.".to_string());
    }
    if location.is_empty() {
        return Err("Enter a location, e.g. \"Austin, TX\".".to_string());
    }

    let api_key = keychain::get_api_key()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No API key configured. Add one in Settings.".to_string())?;

    let area = geocoding::geocode_to_viewport(&api_key, &location)
        .await
        .map_err(|e| e.to_string())?;

    let configured_cap = places::cost::get_per_run_call_cap(&db.0)
        .await
        .map_err(|e| e.to_string())?;
    let params = DeepSearchParams {
        max_depth: max_depth.unwrap_or(6),
        min_tile_degrees: 0.01,
        call_cap: call_cap.unwrap_or(configured_cap),
    };

    let cancel = Arc::new(AtomicBool::new(false));
    registry.0.lock().unwrap().insert(run_id.clone(), cancel.clone());

    let mut fetcher = quadtree::LiveTileFetcher {
        pool: &db.0,
        client: &client,
        api_key: &api_key,
        query: &query,
    };

    let run_id_for_progress = run_id.clone();
    let app_for_progress = app.clone();
    let outcome = quadtree::run_deep_search(
        &mut fetcher,
        area.viewport,
        params,
        cancel,
        move |progress: &DeepSearchProgress| {
            let event = DeepSearchProgressEvent {
                run_id: run_id_for_progress.clone(),
                tiles_scanned: progress.tiles_scanned,
                tiles_subdivided: progress.tiles_subdivided,
                unique_places_found: progress.unique_places_found,
                calls_made: progress.calls_made,
                estimated_cost_usd: estimated_search_cost_usd(progress.calls_made),
                done: progress.done,
                cancelled: progress.cancelled,
                call_cap_reached: progress.call_cap_reached,
            };
            let _ = app_for_progress.emit("deep-search-progress", event);
        },
    )
    .await
    .map_err(|e| e.to_string());

    registry.0.lock().unwrap().remove(&run_id);
    let outcome = outcome?;

    Ok(DeepSearchSummary {
        place_ids: outcome.place_ids,
        tiles_scanned: outcome.tiles_scanned,
        tiles_subdivided: outcome.tiles_subdivided,
        calls_made: outcome.calls_made,
        estimated_cost_usd: estimated_search_cost_usd(outcome.calls_made),
        cancelled: outcome.cancelled,
        call_cap_reached: outcome.call_cap_reached,
        area_formatted_address: area.formatted_address,
    })
}

#[tauri::command]
pub fn cancel_deep_search(registry: tauri::State<'_, DeepSearchRegistry>, run_id: String) -> Result<(), String> {
    if let Some(flag) = registry.0.lock().unwrap().get(&run_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
