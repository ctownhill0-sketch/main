//! The `#[tauri::command]` surface exposed to the frontend. Kept thin —
//! real logic lives in the modules these commands call into.

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
