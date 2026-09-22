//! Thin client for the Google Geocoding API.
//!
//! Used (a) to validate a freshly-entered API key with one cheap call during
//! onboarding, and (b) in Deep Search (Phase 6) to turn a typed location into
//! a viewport for `locationRestriction` tiling.

use serde::Deserialize;

const GEOCODE_URL: &str = "https://maps.googleapis.com/maps/api/geocode/json";

#[derive(Debug, Deserialize)]
struct GeocodeResponse {
    status: String,
    #[serde(default)]
    error_message: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum GeocodingError {
    #[error("network error contacting Google Geocoding API: {0}")]
    Network(#[from] reqwest::Error),
}

pub struct KeyValidation {
    pub valid: bool,
    /// Google's status code (e.g. "OK", "REQUEST_DENIED") plus, when present,
    /// its human-readable `error_message`, for surfacing a specific reason.
    pub detail: String,
}

/// Validates an API key with a single, minimal Geocoding API call. Returns
/// `Ok(KeyValidation { valid: false, .. })` (not `Err`) for a bad or
/// unauthorized key — an `Err` means we couldn't reach Google at all.
pub async fn validate_api_key(api_key: &str) -> Result<KeyValidation, GeocodingError> {
    let client = reqwest::Client::new();
    let resp = client
        .get(GEOCODE_URL)
        .query(&[("address", "New York, NY"), ("key", api_key)])
        .send()
        .await?
        .json::<GeocodeResponse>()
        .await?;

    let detail = match &resp.error_message {
        Some(msg) => format!("{}: {}", resp.status, msg),
        None => resp.status.clone(),
    };

    Ok(KeyValidation {
        valid: resp.status == "OK",
        detail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail_for(status: &str, error_message: Option<&str>) -> (bool, String) {
        let resp = GeocodeResponse {
            status: status.to_string(),
            error_message: error_message.map(str::to_string),
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
}
