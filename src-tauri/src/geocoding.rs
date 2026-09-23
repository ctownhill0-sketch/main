//! Client for the Google Geocoding API.
//!
//! Kept separate from `PlacesClient` (places/client.rs) since it hits a
//! different host (`maps.googleapis.com`, not `places.googleapis.com`) and
//! `PlacesClient`'s own doc comment scopes it to Places only. Mirrors
//! `PlacesClient`'s shape: owns a shared rate limiter, checks the monthly
//! spend cap before every call, and logs every call to `api_call_log` —
//! CLAUDE.md requires "every Places/Geocoding/Aggregate API call is
//! logged," which this module didn't actually do until now (a pre-existing
//! gap, fixed here since a debounced location input calls this far more
//! often than the old 1x-per-Deep-Search-run usage).
//!
//! Used to (a) validate a freshly-entered API key with one cheap call
//! during onboarding, (b) turn a typed location into a viewport for Deep
//! Search's `locationRestriction` tiling, and (c) resolve a debounced
//! location input for the shared search surface (`resolve_location`).

use serde::Deserialize;
use sqlx::SqlitePool;

use crate::places::cost::{self, Tier};
use crate::places::rate_limit::RateLimiter;
use crate::places::{LatLngLiteral, Viewport};

const GEOCODE_URL: &str = "https://maps.googleapis.com/maps/api/geocode/json";

#[derive(Debug, Deserialize)]
struct GeocodeResponse {
    status: String,
    #[serde(default)]
    error_message: Option<String>,
    #[serde(default)]
    results: Vec<GeocodeResult>,
}

#[derive(Debug, Deserialize)]
struct GeocodeResult {
    geometry: Geometry,
    #[serde(default)]
    formatted_address: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Geometry {
    viewport: LatLngBounds,
    /// Present for larger regions (e.g. a city or country); more accurate
    /// than `viewport` when available.
    #[serde(default)]
    bounds: Option<LatLngBounds>,
}

#[derive(Debug, Deserialize)]
struct LatLngBounds {
    northeast: LatLng,
    southwest: LatLng,
}

#[derive(Debug, Deserialize, Clone, Copy)]
struct LatLng {
    lat: f64,
    lng: f64,
}

#[derive(Debug, thiserror::Error)]
pub enum GeocodingError {
    #[error("network error contacting Google Geocoding API: {0}")]
    Network(#[from] reqwest::Error),
    #[error("couldn't find that location ({0})")]
    NotFound(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("database error: {0}")]
    Cost(#[from] cost::CostError),
    #[error(
        "monthly spend cap would be exceeded: ${spent:.2} already spent this month, \
         cap is ${cap:.2}"
    )]
    SpendCapExceeded { spent: f64, cap: f64 },
}

pub struct KeyValidation {
    pub valid: bool,
    /// Google's status code (e.g. "OK", "REQUEST_DENIED") plus, when present,
    /// its human-readable `error_message`, for surfacing a specific reason.
    pub detail: String,
}

#[derive(Debug)]
pub struct GeocodedArea {
    pub formatted_address: String,
    pub viewport: Viewport,
}

pub struct GeocodingClient {
    http: reqwest::Client,
    limiter: RateLimiter,
}

impl GeocodingClient {
    pub fn new(qps: f64) -> Self {
        Self {
            http: reqwest::Client::new(),
            limiter: RateLimiter::new(qps),
        }
    }

    async fn check_spend_cap(&self, pool: &SqlitePool) -> Result<(), GeocodingError> {
        let spent = cost::month_to_date_spend_usd(pool).await?;
        let cap = cost::get_monthly_spend_cap_usd(pool).await?;
        let next_cost = Tier::Geocoding.cost_per_call_usd();

        if spent + next_cost > cap {
            return Err(GeocodingError::SpendCapExceeded { spent, cap });
        }
        Ok(())
    }

    async fn log_call(&self, pool: &SqlitePool, success: bool, error_message: Option<&str>) {
        let cost = Tier::Geocoding.cost_per_call_usd();
        let _ = sqlx::query(
            "INSERT INTO api_call_log \
             (endpoint, mask_name, tier, estimated_cost_usd, success, error_message) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("geocode")
        .bind("n/a")
        .bind("Geocoding")
        .bind(cost)
        .bind(success as i64)
        .bind(error_message)
        .execute(pool)
        .await;
    }

    /// Checks the spend cap, rate-limits, sends the request, and logs the
    /// call (success or failure) before returning — the same
    /// check-then-log-unconditionally shape as `PlacesClient::execute_and_log`.
    async fn send_and_log(
        &self,
        pool: &SqlitePool,
        api_key: &str,
        address: &str,
    ) -> Result<GeocodeResponse, GeocodingError> {
        self.check_spend_cap(pool).await?;
        self.limiter.acquire().await;

        let result = match self
            .http
            .get(GEOCODE_URL)
            .query(&[("address", address), ("key", api_key)])
            .send()
            .await
        {
            Ok(resp) => resp.json::<GeocodeResponse>().await,
            Err(e) => Err(e),
        };

        match &result {
            Ok(_) => self.log_call(pool, true, None).await,
            Err(e) => self.log_call(pool, false, Some(&e.to_string())).await,
        }

        result.map_err(GeocodingError::from)
    }

    /// Validates an API key with a single, minimal Geocoding API call.
    /// Returns `Ok(KeyValidation { valid: false, .. })` (not `Err`) for a
    /// bad or unauthorized key — an `Err` means we couldn't reach Google or
    /// the spend cap blocked the call.
    pub async fn validate_api_key(
        &self,
        pool: &SqlitePool,
        api_key: &str,
    ) -> Result<KeyValidation, GeocodingError> {
        let resp = self.send_and_log(pool, api_key, "New York, NY").await?;

        let detail = match &resp.error_message {
            Some(msg) => format!("{}: {}", resp.status, msg),
            None => resp.status.clone(),
        };

        Ok(KeyValidation {
            valid: resp.status == "OK",
            detail,
        })
    }

    /// Turns a typed location (e.g. "Austin, TX") into a viewport for Deep
    /// Search's `locationRestriction` tiling, or for the shared search
    /// surface's location confirmation. Prefers the geometry `bounds` (more
    /// accurate for a named region) over the looser `viewport` when Google
    /// returns both.
    pub async fn geocode_to_viewport(
        &self,
        pool: &SqlitePool,
        api_key: &str,
        location: &str,
    ) -> Result<GeocodedArea, GeocodingError> {
        let resp = self.send_and_log(pool, api_key, location).await?;

        if resp.status != "OK" {
            let detail = match &resp.error_message {
                Some(msg) => format!("{}: {}", resp.status, msg),
                None => resp.status.clone(),
            };
            return Err(GeocodingError::NotFound(detail));
        }

        let Some(first) = resp.results.into_iter().next() else {
            return Err(GeocodingError::NotFound("ZERO_RESULTS".to_string()));
        };

        let bounds = first.geometry.bounds.unwrap_or(first.geometry.viewport);
        Ok(GeocodedArea {
            formatted_address: first.formatted_address.unwrap_or_else(|| location.to_string()),
            viewport: Viewport {
                low: LatLngLiteral {
                    latitude: bounds.southwest.lat,
                    longitude: bounds.southwest.lng,
                },
                high: LatLngLiteral {
                    latitude: bounds.northeast.lat,
                    longitude: bounds.northeast.lng,
                },
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail_for(status: &str, error_message: Option<&str>) -> (bool, String) {
        let resp = GeocodeResponse {
            status: status.to_string(),
            error_message: error_message.map(str::to_string),
            results: Vec::new(),
        };
        let detail = match &resp.error_message {
            Some(msg) => format!("{}: {}", resp.status, msg),
            None => resp.status.clone(),
        };
        (resp.status == "OK", detail)
    }

    #[test]
    fn ok_status_is_valid_with_no_extra_detail() {
        let (valid, detail) = detail_for("OK", None);
        assert!(valid);
        assert_eq!(detail, "OK");
    }

    #[test]
    fn request_denied_is_invalid_and_carries_the_reason() {
        let (valid, detail) = detail_for("REQUEST_DENIED", Some("The provided API key is invalid."));
        assert!(!valid);
        assert_eq!(detail, "REQUEST_DENIED: The provided API key is invalid.");
    }

    async fn seeded_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn spend_cap_is_enforced_before_any_network_call() {
        let pool = seeded_pool().await;
        sqlx::query("UPDATE settings SET value = '0' WHERE key = 'monthly_spend_cap_usd'")
            .execute(&pool)
            .await
            .unwrap();

        let client = GeocodingClient::new(5.0);
        let err = client
            .geocode_to_viewport(&pool, "fake-key", "Austin, TX")
            .await
            .unwrap_err();

        assert!(matches!(err, GeocodingError::SpendCapExceeded { .. }));

        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM api_call_log")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "no log row should be written for a call that never went out");
    }
}
