//! Recently-resolved locations, for the search surface's "recent locations"
//! dropdown — instant re-selection without re-spending a Geocoding call.
//! Capped at the 20 most-recently-used rows, enforced here in Rust (same
//! app-level-cap pattern as spend/call caps elsewhere in this codebase),
//! not a SQL trigger.

use serde::Serialize;
use sqlx::SqlitePool;

use crate::geocoding::GeocodedArea;

const MAX_RECENT_LOCATIONS: i64 = 20;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecentLocationRow {
    pub id: i64,
    pub formatted_address: String,
    pub low_lat: f64,
    pub low_lng: f64,
    pub high_lat: f64,
    pub high_lng: f64,
    pub last_used_at: String,
    pub use_count: i64,
}

/// Upserts by `formatted_address` (bumping `use_count`/`last_used_at` on a
/// repeat resolution), then evicts everything beyond the 20 most-recently-used.
pub async fn record(pool: &SqlitePool, area: &GeocodedArea) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO recent_locations \
         (formatted_address, low_lat, low_lng, high_lat, high_lng, last_used_at, use_count) \
         VALUES (?, ?, ?, ?, ?, datetime('now'), 1) \
         ON CONFLICT(formatted_address) DO UPDATE SET \
           low_lat = excluded.low_lat, low_lng = excluded.low_lng, \
           high_lat = excluded.high_lat, high_lng = excluded.high_lng, \
           last_used_at = datetime('now'), use_count = use_count + 1",
    )
    .bind(&area.formatted_address)
    .bind(area.viewport.low.latitude)
    .bind(area.viewport.low.longitude)
    .bind(area.viewport.high.latitude)
    .bind(area.viewport.high.longitude)
    .execute(pool)
    .await?;

    sqlx::query(
        "DELETE FROM recent_locations WHERE id NOT IN \
         (SELECT id FROM recent_locations ORDER BY last_used_at DESC LIMIT ?)",
    )
    .bind(MAX_RECENT_LOCATIONS)
    .execute(pool)
    .await?;

    Ok(())
}

type RecentLocationTuple = (i64, String, f64, f64, f64, f64, String, i64);

pub async fn list(pool: &SqlitePool) -> Result<Vec<RecentLocationRow>, sqlx::Error> {
    let rows: Vec<RecentLocationTuple> = sqlx::query_as(
        "SELECT id, formatted_address, low_lat, low_lng, high_lat, high_lng, last_used_at, use_count \
         FROM recent_locations ORDER BY last_used_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, formatted_address, low_lat, low_lng, high_lat, high_lng, last_used_at, use_count)| {
                RecentLocationRow {
                    id,
                    formatted_address,
                    low_lat,
                    low_lng,
                    high_lat,
                    high_lng,
                    last_used_at,
                    use_count,
                }
            },
        )
        .collect())
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM recent_locations WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::places::{LatLngLiteral, Viewport};

    async fn seeded_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn area(address: &str) -> GeocodedArea {
        GeocodedArea {
            formatted_address: address.to_string(),
            viewport: Viewport {
                low: LatLngLiteral { latitude: 1.0, longitude: 2.0 },
                high: LatLngLiteral { latitude: 3.0, longitude: 4.0 },
            },
        }
    }

    #[tokio::test]
    async fn recording_the_same_address_twice_bumps_use_count_not_a_duplicate_row() {
        let pool = seeded_pool().await;
        record(&pool, &area("Austin, TX")).await.unwrap();
        record(&pool, &area("Austin, TX")).await.unwrap();

        let rows = list(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].use_count, 2);
    }

    #[tokio::test]
    async fn eviction_keeps_only_the_20_most_recently_used() {
        let pool = seeded_pool().await;
        for i in 0..25 {
            record(&pool, &area(&format!("City {i}"))).await.unwrap();
        }

        let rows = list(&pool).await.unwrap();
        assert_eq!(rows.len(), 20, "eviction must cap at 20 rows");
        // The 5 oldest (City 0..City 4) should have been evicted.
        assert!(!rows.iter().any(|r| r.formatted_address == "City 0"));
        assert!(rows.iter().any(|r| r.formatted_address == "City 24"));
    }

    #[tokio::test]
    async fn deleting_a_recent_location_removes_it() {
        let pool = seeded_pool().await;
        record(&pool, &area("Austin, TX")).await.unwrap();
        let id = list(&pool).await.unwrap()[0].id;
        delete(&pool, id).await.unwrap();
        assert!(list(&pool).await.unwrap().is_empty());
    }
}
