//! The one and only module that talks to `places.googleapis.com`. Every
//! public method here takes an explicit `PlaceMask` and logs the call
//! (endpoint, mask, tier, estimated cost, success) to `api_call_log` before
//! returning — see CLAUDE.md for why that rule exists.

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::cost::{self, Tier};
use super::masks::PlaceMask;
use super::rate_limit::{Backoff, RateLimiter};

const SEARCH_TEXT_URL: &str = "https://places.googleapis.com/v1/places:searchText";
const SEARCH_NEARBY_URL: &str = "https://places.googleapis.com/v1/places:searchNearby";
const PLACE_DETAILS_BASE_URL: &str = "https://places.googleapis.com/v1/places";

/// Hard cap Google enforces on Text/Nearby Search pagination: 20 per page,
/// 3 pages (60 results) maximum — no override exists.
pub const MAX_PAGE_SIZE: u32 = 20;
pub const MAX_RESULTS_PER_QUERY: u32 = 60;

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("network error contacting Google: {0}")]
    Network(#[from] reqwest::Error),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("database error: {0}")]
    Cost(#[from] cost::CostError),
    #[error("Google API error: {0}")]
    Api(String),
    #[error(
        "monthly spend cap would be exceeded: ${spent:.2} already spent this month, \
         cap is ${cap:.2}"
    )]
    SpendCapExceeded { spent: f64, cap: f64 },
    #[error("failed to parse Google API response: {0}")]
    Parse(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RankPreference {
    Relevance,
    Distance,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct LatLngLiteral {
    pub latitude: f64,
    pub longitude: f64,
}

/// A rectangular viewport for `locationRestriction`, used instead of
/// `locationBias` so results are forced inside the tile being searched.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Viewport {
    pub low: LatLngLiteral,
    pub high: LatLngLiteral,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct LocalizedText {
    pub text: String,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct PlaceResult {
    pub id: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<LocalizedText>,
    #[serde(rename = "formattedAddress")]
    pub formatted_address: Option<String>,
    pub location: Option<LatLngLiteral>,
    #[serde(rename = "businessStatus")]
    pub business_status: Option<String>,
    #[serde(rename = "primaryType")]
    pub primary_type: Option<String>,

    // Only populated when fetched with MASK_DETAILS_ENTERPRISE.
    #[serde(rename = "nationalPhoneNumber")]
    pub national_phone_number: Option<String>,
    #[serde(rename = "internationalPhoneNumber")]
    pub international_phone_number: Option<String>,
    #[serde(rename = "websiteUri")]
    pub website_uri: Option<String>,
    pub rating: Option<f64>,
    #[serde(rename = "userRatingCount")]
    pub user_rating_count: Option<u32>,
    #[serde(rename = "googleMapsUri")]
    pub google_maps_uri: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SearchResponse {
    #[serde(default)]
    pub places: Vec<PlaceResult>,
    #[serde(rename = "nextPageToken")]
    pub next_page_token: Option<String>,
}

pub struct PlacesClient {
    http: reqwest::Client,
    limiter: RateLimiter,
}

impl PlacesClient {
    pub fn new(qps: f64) -> Self {
        Self {
            http: reqwest::Client::new(),
            limiter: RateLimiter::new(qps),
        }
    }

    /// Text Search — discovery only, always `MASK_DISCOVERY`. `page_token`
    /// continues a previous query's pagination (max 3 pages / 60 results
    /// total, enforced by the caller, not this method). `included_type` is
    /// Text Search's structured type filter — singular (one type per
    /// request), unlike Nearby Search's `includedTypes` array — layered on
    /// top of the free-text `query`, not a replacement for it.
    pub async fn search_text(
        &self,
        pool: &SqlitePool,
        api_key: &str,
        query: &str,
        location_restriction: Option<Viewport>,
        rank_preference: Option<RankPreference>,
        page_token: Option<&str>,
        included_type: Option<&str>,
    ) -> Result<SearchResponse, ClientError> {
        let mask = PlaceMask::Discovery;
        self.check_spend_cap(pool, mask.tier()).await?;

        #[derive(Serialize)]
        struct Body<'a> {
            #[serde(rename = "textQuery")]
            text_query: &'a str,
            #[serde(rename = "pageSize")]
            page_size: u32,
            #[serde(rename = "pageToken", skip_serializing_if = "Option::is_none")]
            page_token: Option<&'a str>,
            #[serde(rename = "locationRestriction", skip_serializing_if = "Option::is_none")]
            location_restriction: Option<Viewport>,
            #[serde(rename = "rankPreference", skip_serializing_if = "Option::is_none")]
            rank_preference: Option<RankPreference>,
            #[serde(rename = "includedType", skip_serializing_if = "Option::is_none")]
            included_type: Option<&'a str>,
        }

        let body = Body {
            text_query: query,
            page_size: MAX_PAGE_SIZE,
            page_token,
            location_restriction,
            rank_preference,
            included_type,
        };

        let value = self
            .execute_and_log(pool, "searchText", mask, |http, key| {
                http.post(SEARCH_TEXT_URL)
                    .header("X-Goog-Api-Key", key)
                    .header("X-Goog-FieldMask", mask.field_mask())
                    .json(&body)
            }, api_key)
            .await?;

        Ok(serde_json::from_value(value)?)
    }

    /// Nearby Search — discovery only, always `MASK_DISCOVERY`.
    pub async fn search_nearby(
        &self,
        pool: &SqlitePool,
        api_key: &str,
        center: LatLngLiteral,
        radius_meters: f64,
        included_types: &[&str],
        rank_preference: Option<RankPreference>,
    ) -> Result<SearchResponse, ClientError> {
        let mask = PlaceMask::Discovery;
        self.check_spend_cap(pool, mask.tier()).await?;

        #[derive(Serialize)]
        struct Circle {
            center: LatLngLiteral,
            radius: f64,
        }
        #[derive(Serialize)]
        struct LocationRestriction {
            circle: Circle,
        }
        #[derive(Serialize)]
        struct Body<'a> {
            #[serde(rename = "locationRestriction")]
            location_restriction: LocationRestriction,
            #[serde(rename = "includedTypes", skip_serializing_if = "Vec::is_empty")]
            included_types: Vec<&'a str>,
            #[serde(rename = "rankPreference", skip_serializing_if = "Option::is_none")]
            rank_preference: Option<RankPreference>,
        }

        let body = Body {
            location_restriction: LocationRestriction {
                circle: Circle { center, radius: radius_meters },
            },
            included_types: included_types.to_vec(),
            rank_preference,
        };

        let value = self
            .execute_and_log(pool, "searchNearby", mask, |http, key| {
                http.post(SEARCH_NEARBY_URL)
                    .header("X-Goog-Api-Key", key)
                    .header("X-Goog-FieldMask", mask.field_mask())
                    .json(&body)
            }, api_key)
            .await?;

        Ok(serde_json::from_value(value)?)
    }

    /// Place Details — `mask` must be `DetailsEnterprise` (only for
    /// explicitly kept leads) or `IdOnly` (refresh/validate a place ID).
    /// Passing `PlaceMask::Discovery` here is a programmer error; it is
    /// rejected rather than silently sent (Search-only fields aren't valid
    /// on this endpoint).
    pub async fn get_place_details(
        &self,
        pool: &SqlitePool,
        api_key: &str,
        place_id: &str,
        mask: PlaceMask,
    ) -> Result<PlaceResult, ClientError> {
        if mask == PlaceMask::Discovery {
            return Err(ClientError::Api(
                "MASK_DISCOVERY is a Search-only mask and cannot be used with Place Details"
                    .to_string(),
            ));
        }
        self.check_spend_cap(pool, mask.tier()).await?;

        let url = format!("{PLACE_DETAILS_BASE_URL}/{place_id}");
        let value = self
            .execute_and_log(pool, "getPlaceDetails", mask, |http, key| {
                http.get(&url)
                    .header("X-Goog-Api-Key", key)
                    .header("X-Goog-FieldMask", mask.field_mask())
            }, api_key)
            .await?;

        Ok(serde_json::from_value(value)?)
    }

    async fn check_spend_cap(&self, pool: &SqlitePool, tier: Tier) -> Result<(), ClientError> {
        let spent = cost::month_to_date_spend_usd(pool).await?;
        let cap = cost::get_monthly_spend_cap_usd(pool).await?;
        let next_cost = tier.cost_per_call_usd();

        if spent + next_cost > cap {
            return Err(ClientError::SpendCapExceeded { spent, cap });
        }
        Ok(())
    }

    /// Sends the request built by `build_request`, retrying on 429 /
    /// RESOURCE_EXHAUSTED with exponential backoff, then unconditionally
    /// logs the call (success or failure) before returning.
    async fn execute_and_log(
        &self,
        pool: &SqlitePool,
        endpoint: &str,
        mask: PlaceMask,
        build_request: impl Fn(&reqwest::Client, &str) -> reqwest::RequestBuilder,
        api_key: &str,
    ) -> Result<serde_json::Value, ClientError> {
        let mut backoff = Backoff::new();

        let response = loop {
            self.limiter.acquire().await;
            let result = build_request(&self.http, api_key).send().await;

            match &result {
                Ok(resp) if resp.status() == StatusCode::TOO_MANY_REQUESTS && backoff.attempts() < 5 => {
                    tokio::time::sleep(backoff.next_delay()).await;
                    continue;
                }
                _ => break result,
            }
        };

        let (success, error_message, value) = match response {
            Ok(resp) => {
                let status = resp.status();
                match resp.json::<serde_json::Value>().await {
                    Ok(v) if status.is_success() => (true, None, Some(v)),
                    Ok(v) => {
                        let msg = v
                            .get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("unknown error from Google")
                            .to_string();
                        (false, Some(msg), None)
                    }
                    Err(e) => (false, Some(e.to_string()), None),
                }
            }
            Err(e) => (false, Some(e.to_string()), None),
        };

        self.log_call(pool, endpoint, mask, success, error_message.as_deref())
            .await;

        match value {
            Some(v) if success => Ok(v),
            _ => Err(ClientError::Api(
                error_message.unwrap_or_else(|| "request failed".to_string()),
            )),
        }
    }

    async fn log_call(
        &self,
        pool: &SqlitePool,
        endpoint: &str,
        mask: PlaceMask,
        success: bool,
        error_message: Option<&str>,
    ) {
        let tier = mask.tier();
        let cost = tier.cost_per_call_usd();
        let tier_name = format!("{:?}", tier);

        let _ = sqlx::query(
            "INSERT INTO api_call_log \
             (endpoint, mask_name, tier, estimated_cost_usd, success, error_message) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(endpoint)
        .bind(mask.name())
        .bind(tier_name)
        .bind(cost)
        .bind(success as i64)
        .bind(error_message)
        .execute(pool)
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn seeded_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn get_place_details_rejects_the_discovery_mask() {
        let client = PlacesClient::new(5.0);
        let pool = seeded_pool().await;
        let err = client
            .get_place_details(&pool, "fake-key", "some-place-id", PlaceMask::Discovery)
            .await
            .unwrap_err();
        assert!(matches!(err, ClientError::Api(_)));
    }

    #[tokio::test]
    async fn spend_cap_is_enforced_before_any_network_call() {
        let pool = seeded_pool().await;
        sqlx::query("UPDATE settings SET value = '0' WHERE key = 'monthly_spend_cap_usd'")
            .execute(&pool)
            .await
            .unwrap();

        let client = PlacesClient::new(5.0);
        let err = client
            .search_text(&pool, "fake-key", "coffee shops", None, None, None, None)
            .await
            .unwrap_err();

        assert!(matches!(err, ClientError::SpendCapExceeded { .. }));

        // No log row should be written for a call that never went out.
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM api_call_log")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
