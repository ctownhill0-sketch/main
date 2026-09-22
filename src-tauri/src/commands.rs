//! The `#[tauri::command]` surface exposed to the frontend. Kept thin —
//! real logic lives in the modules these commands call into.

use std::time::Duration;

use crate::db::AppDb;
use crate::places::{self, PlaceRow, PlacesClient};
use crate::{geocoding, keychain};

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
