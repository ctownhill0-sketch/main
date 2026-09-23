//! Saved searches: persisted search parameters that can be re-run later,
//! with "new since last run" highlighting by place ID.
//!
//! Quick Search mode only for now — Deep Search re-runs would need the
//! same run-id/progress-event plumbing `start_deep_search` uses, which
//! isn't wired up here; a saved Deep Search could be added by reusing
//! `quadtree::run_deep_search` the same way `run_quick_search` is reused
//! below.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::places::client::{ClientError, PlacesClient, RankPreference};
use crate::places::search::run_quick_search;
use crate::places::store::get_places;
use crate::places::PlaceRow;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearchParams {
    pub query: String,
    pub rank_preference: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearchRow {
    pub id: i64,
    pub name: String,
    pub params: SavedSearchParams,
    pub created_at: String,
    pub last_run_at: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum SavedSearchError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("stored search params are corrupt: {0}")]
    Corrupt(#[from] serde_json::Error),
    #[error(transparent)]
    Client(#[from] ClientError),
}

pub async fn save(pool: &SqlitePool, name: &str, params: &SavedSearchParams) -> Result<i64, SavedSearchError> {
    let json = serde_json::to_string(params)?;
    let id = sqlx::query("INSERT INTO saved_searches (name, params_json) VALUES (?, ?)")
        .bind(name)
        .bind(json)
        .execute(pool)
        .await?
        .last_insert_rowid();
    Ok(id)
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<SavedSearchRow>, SavedSearchError> {
    let rows: Vec<(i64, String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, name, params_json, created_at, last_run_at FROM saved_searches ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|(id, name, params_json, created_at, last_run_at)| {
            Ok(SavedSearchRow {
                id,
                name,
                params: serde_json::from_str(&params_json)?,
                created_at,
                last_run_at,
            })
        })
        .collect()
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<(), SavedSearchError> {
    sqlx::query("DELETE FROM saved_searches WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Re-runs a saved search's Quick Search, marks it as just-run, and
/// returns both the full result set and which place IDs are new since the
/// last time this saved search was run (by place ID — never seen before
/// for this particular saved search).
pub async fn run(
    pool: &SqlitePool,
    client: &PlacesClient,
    api_key: &str,
    saved_search_id: i64,
) -> Result<(Vec<PlaceRow>, Vec<String>), SavedSearchError> {
    let (params_json,): (String,) =
        sqlx::query_as("SELECT params_json FROM saved_searches WHERE id = ?")
            .bind(saved_search_id)
            .fetch_one(pool)
            .await?;
    let params: SavedSearchParams = serde_json::from_str(&params_json)?;

    let rank = match params.rank_preference.as_deref() {
        Some("DISTANCE") => Some(RankPreference::Distance),
        Some("RELEVANCE") => Some(RankPreference::Relevance),
        _ => None,
    };

    let place_ids = run_quick_search(pool, client, api_key, &params.query, rank, None).await?;
    let new_ids = diff_new_place_ids(pool, saved_search_id, &place_ids).await?;

    sqlx::query("UPDATE saved_searches SET last_run_at = datetime('now') WHERE id = ?")
        .bind(saved_search_id)
        .execute(pool)
        .await?;

    let results = get_places(pool, &place_ids).await?;
    Ok((results, new_ids))
}

/// Records which place IDs have now been seen for this saved search and
/// returns only the ones that were newly inserted (i.e. seen for the
/// first time by this saved search).
async fn diff_new_place_ids(
    pool: &SqlitePool,
    saved_search_id: i64,
    place_ids: &[String],
) -> Result<Vec<String>, sqlx::Error> {
    let mut new_ids = Vec::new();
    for place_id in place_ids {
        let result = sqlx::query(
            "INSERT INTO saved_search_seen_places (saved_search_id, place_id) VALUES (?, ?) \
             ON CONFLICT(saved_search_id, place_id) DO NOTHING",
        )
        .bind(saved_search_id)
        .bind(place_id)
        .execute(pool)
        .await?;
        if result.rows_affected() > 0 {
            new_ids.push(place_id.clone());
        }
    }
    Ok(new_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::places::client::{LatLngLiteral, PlaceResult};
    use crate::places::store::upsert_discovered_place;

    async fn seeded_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn seed_place(pool: &SqlitePool, id: &str) {
        let place = PlaceResult {
            id: Some(id.to_string()),
            location: Some(LatLngLiteral { latitude: 1.0, longitude: 2.0 }),
            ..Default::default()
        };
        upsert_discovered_place(pool, &place).await.unwrap();
    }

    #[tokio::test]
    async fn saving_and_listing_round_trips_the_params() {
        let pool = seeded_pool().await;
        let params = SavedSearchParams {
            query: "coffee shops in Austin, TX".to_string(),
            rank_preference: Some("DISTANCE".to_string()),
        };
        save(&pool, "Austin coffee", &params).await.unwrap();

        let rows = list(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Austin coffee");
        assert_eq!(rows[0].params.query, params.query);
        assert_eq!(rows[0].params.rank_preference, params.rank_preference);
        assert!(rows[0].last_run_at.is_none());
    }

    #[tokio::test]
    async fn first_diff_treats_every_place_as_new_second_diff_finds_nothing_new() {
        let pool = seeded_pool().await;
        for p in ["a", "b", "c"] {
            seed_place(&pool, p).await;
        }
        let params = SavedSearchParams { query: "q".to_string(), rank_preference: None };
        let id = save(&pool, "s", &params).await.unwrap();

        let first = diff_new_place_ids(&pool, id, &["a".to_string(), "b".to_string()])
            .await
            .unwrap();
        assert_eq!(first.len(), 2);

        let second = diff_new_place_ids(&pool, id, &["a".to_string(), "b".to_string()])
            .await
            .unwrap();
        assert!(second.is_empty(), "already-seen places must not be reported as new");

        let third = diff_new_place_ids(&pool, id, &["a".to_string(), "c".to_string()])
            .await
            .unwrap();
        assert_eq!(third, vec!["c".to_string()], "only the genuinely new place should show up");
    }

    #[tokio::test]
    async fn deleting_a_saved_search_removes_it() {
        let pool = seeded_pool().await;
        let params = SavedSearchParams { query: "q".to_string(), rank_preference: None };
        let id = save(&pool, "s", &params).await.unwrap();
        delete(&pool, id).await.unwrap();
        assert!(list(&pool).await.unwrap().is_empty());
    }
}
