//! Persistence for discovered places. Place IDs are kept forever per
//! Google Maps Platform ToS §3.2.3(b); lat/lng are cached but purged after
//! 30 days by `db::run_startup_cleanup`. Other Google Maps Content (name,
//! address, phone, website, rating) is refreshed in place on every
//! rediscovery/enrichment rather than accumulated as history.

use serde::Serialize;
use sqlx::SqlitePool;

use super::client::PlaceResult;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaceRow {
    pub place_id: String,
    pub display_name: Option<String>,
    pub formatted_address: Option<String>,
    pub primary_type: Option<String>,
    pub business_status: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub discovered_at: String,
    pub cached_at: Option<String>,
    pub national_phone_number: Option<String>,
    pub website_uri: Option<String>,
    pub rating: Option<f64>,
    pub user_rating_count: Option<i64>,
    pub last_details_refreshed_at: Option<String>,
}

/// Inserts a freshly-discovered place, or refreshes an existing one's
/// display fields and coordinates on rediscovery. Never touches
/// `discovered_at` for an existing row — that's the original discovery
/// timestamp, kept indefinitely alongside the place_id.
pub async fn upsert_discovered_place(pool: &SqlitePool, place: &PlaceResult) -> Result<(), sqlx::Error> {
    let Some(place_id) = &place.id else {
        return Ok(()); // Google should always return an id; skip defensively if not.
    };
    let display_name = place.display_name.as_ref().map(|n| n.text.clone());
    let lat = place.location.map(|l| l.latitude);
    let lng = place.location.map(|l| l.longitude);

    sqlx::query(
        "INSERT INTO places (place_id, display_name, formatted_address, primary_type, business_status, cached_lat, cached_lng, cached_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) \
         ON CONFLICT(place_id) DO UPDATE SET \
           display_name = excluded.display_name, \
           formatted_address = excluded.formatted_address, \
           primary_type = excluded.primary_type, \
           business_status = excluded.business_status, \
           cached_lat = excluded.cached_lat, \
           cached_lng = excluded.cached_lng, \
           cached_at = excluded.cached_at",
    )
    .bind(place_id)
    .bind(display_name)
    .bind(&place.formatted_address)
    .bind(&place.primary_type)
    .bind(&place.business_status)
    .bind(lat)
    .bind(lng)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_places(pool: &SqlitePool, place_ids: &[String]) -> Result<Vec<PlaceRow>, sqlx::Error> {
    if place_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = place_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT place_id, display_name, formatted_address, primary_type, business_status, \
                cached_lat as lat, cached_lng as lng, discovered_at, cached_at, \
                national_phone_number, website_uri, rating, user_rating_count, last_details_refreshed_at \
         FROM places WHERE place_id IN ({placeholders}) ORDER BY discovered_at DESC"
    );
    let mut query = sqlx::query_as::<_, PlaceRowSql>(&sql);
    for id in place_ids {
        query = query.bind(id);
    }
    let rows = query.fetch_all(pool).await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

pub async fn list_recent_places(pool: &SqlitePool, limit: i64) -> Result<Vec<PlaceRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, PlaceRowSql>(
        "SELECT place_id, display_name, formatted_address, primary_type, business_status, \
                cached_lat as lat, cached_lng as lng, discovered_at, cached_at, \
                national_phone_number, website_uri, rating, user_rating_count, last_details_refreshed_at \
         FROM places ORDER BY discovered_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

#[derive(sqlx::FromRow)]
struct PlaceRowSql {
    place_id: String,
    display_name: Option<String>,
    formatted_address: Option<String>,
    primary_type: Option<String>,
    business_status: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    discovered_at: String,
    cached_at: Option<String>,
    national_phone_number: Option<String>,
    website_uri: Option<String>,
    rating: Option<f64>,
    user_rating_count: Option<i64>,
    last_details_refreshed_at: Option<String>,
}

impl From<PlaceRowSql> for PlaceRow {
    fn from(r: PlaceRowSql) -> Self {
        PlaceRow {
            place_id: r.place_id,
            display_name: r.display_name,
            formatted_address: r.formatted_address,
            primary_type: r.primary_type,
            business_status: r.business_status,
            lat: r.lat,
            lng: r.lng,
            discovered_at: r.discovered_at,
            cached_at: r.cached_at,
            national_phone_number: r.national_phone_number,
            website_uri: r.website_uri,
            rating: r.rating,
            user_rating_count: r.user_rating_count,
            last_details_refreshed_at: r.last_details_refreshed_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::places::client::{LatLngLiteral, LocalizedText};

    async fn seeded_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn sample_place(id: &str, name: &str) -> PlaceResult {
        PlaceResult {
            id: Some(id.to_string()),
            display_name: Some(LocalizedText { text: name.to_string() }),
            formatted_address: Some("123 Main St".to_string()),
            location: Some(LatLngLiteral { latitude: 30.0, longitude: -97.0 }),
            business_status: Some("OPERATIONAL".to_string()),
            primary_type: Some("cafe".to_string()),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn upsert_then_rediscovery_keeps_the_original_discovered_at() {
        let pool = seeded_pool().await;
        upsert_discovered_place(&pool, &sample_place("p1", "Original Name")).await.unwrap();

        let first = get_places(&pool, &["p1".to_string()]).await.unwrap();
        let first_discovered_at = first[0].discovered_at.clone();

        upsert_discovered_place(&pool, &sample_place("p1", "Renamed Cafe")).await.unwrap();
        let second = get_places(&pool, &["p1".to_string()]).await.unwrap();

        assert_eq!(second[0].display_name.as_deref(), Some("Renamed Cafe"));
        assert_eq!(second[0].discovered_at, first_discovered_at, "discovered_at must not change on rediscovery");
    }

    #[tokio::test]
    async fn list_recent_places_respects_the_limit() {
        let pool = seeded_pool().await;
        for i in 0..5 {
            upsert_discovered_place(&pool, &sample_place(&format!("p{i}"), "Cafe")).await.unwrap();
        }
        let rows = list_recent_places(&pool, 3).await.unwrap();
        assert_eq!(rows.len(), 3);
    }
}
