//! The `#[tauri::command]` surface exposed to the frontend. Kept thin —
//! real logic lives in the modules these commands call into.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::db::AppDb;
use crate::pipeline::{self, LeadEmailRow, LeadRow, TagRow};
use crate::places::{self, PlaceRow, PlacesClient};
use crate::quadtree::{self, DeepSearchParams, DeepSearchProgress};
use crate::saved_searches::{self, SavedSearchParams, SavedSearchRow};
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

    let rank = places::search::parse_rank_preference(rank_preference.as_deref());

    let ids = places::search::run_quick_search(&db.0, &client, &api_key, query, rank)
        .await
        .map_err(|e| e.to_string())?;

    places::store::get_places(&db.0, &ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_places(db: tauri::State<'_, AppDb>) -> Result<Vec<PlaceRow>, String> {
    places::store::list_recent_places(&db.0, 500)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchDetailsResult {
    updated: Vec<PlaceRow>,
    failed: Vec<FailedDetailFetch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedDetailFetch {
    place_id: String,
    error: String,
}

/// Phase-2 spend: fetches MASK_DETAILS_ENTERPRISE for exactly the given
/// place IDs — never "refresh everything". Callers (the frontend) must
/// pass an explicit, non-empty list of places the user selected/kept.
#[tauri::command]
pub async fn fetch_place_details(
    db: tauri::State<'_, AppDb>,
    client: tauri::State<'_, PlacesClient>,
    place_ids: Vec<String>,
) -> Result<FetchDetailsResult, String> {
    if place_ids.is_empty() {
        return Err("Select at least one lead to fetch details for.".to_string());
    }

    let api_key = keychain::get_api_key()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No API key configured. Add one in Settings.".to_string())?;

    let mut updated_ids = Vec::new();
    let mut failed = Vec::new();

    for place_id in &place_ids {
        match client
            .get_place_details(&db.0, &api_key, place_id, places::PlaceMask::DetailsEnterprise)
            .await
        {
            Ok(details) => {
                if let Err(e) = places::store::apply_place_details(&db.0, &details).await {
                    failed.push(FailedDetailFetch { place_id: place_id.clone(), error: e.to_string() });
                    continue;
                }
                updated_ids.push(place_id.clone());
            }
            Err(e) => failed.push(FailedDetailFetch { place_id: place_id.clone(), error: e.to_string() }),
        }
    }

    let updated = places::store::get_places(&db.0, &updated_ids)
        .await
        .map_err(|e| e.to_string())?;

    Ok(FetchDetailsResult { updated, failed })
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

// ---------------------------------------------------------------------
// Pipeline (leads, tags, statuses)
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn add_lead(db: tauri::State<'_, AppDb>, place_id: String) -> Result<i64, String> {
    pipeline::add_lead(&db.0, &place_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_lead(db: tauri::State<'_, AppDb>, lead_id: i64) -> Result<(), String> {
    pipeline::remove_lead(&db.0, lead_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_lead_status(
    db: tauri::State<'_, AppDb>,
    lead_id: i64,
    status: String,
) -> Result<(), String> {
    pipeline::update_status(&db.0, lead_id, &status).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_lead_notes(
    db: tauri::State<'_, AppDb>,
    lead_id: i64,
    notes: String,
) -> Result<(), String> {
    pipeline::update_notes(&db.0, lead_id, &notes).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_leads(db: tauri::State<'_, AppDb>) -> Result<Vec<LeadRow>, String> {
    pipeline::list_leads(&db.0).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_tags(db: tauri::State<'_, AppDb>) -> Result<Vec<TagRow>, String> {
    pipeline::list_tags(&db.0).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_tag(
    db: tauri::State<'_, AppDb>,
    name: String,
    color: Option<String>,
) -> Result<TagRow, String> {
    pipeline::create_tag(&db.0, &name, color.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_lead_tags(
    db: tauri::State<'_, AppDb>,
    lead_id: i64,
    tag_ids: Vec<i64>,
) -> Result<(), String> {
    pipeline::set_lead_tags(&db.0, lead_id, &tag_ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_lead_statuses(db: tauri::State<'_, AppDb>) -> Result<Vec<String>, String> {
    pipeline::get_lead_statuses(&db.0).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_lead_statuses(db: tauri::State<'_, AppDb>, statuses: Vec<String>) -> Result<(), String> {
    pipeline::set_lead_statuses(&db.0, &statuses).await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn save_search(
    db: tauri::State<'_, AppDb>,
    name: String,
    query: String,
    rank_preference: Option<String>,
) -> Result<i64, String> {
    let params = SavedSearchParams { query, rank_preference };
    saved_searches::save(&db.0, &name, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_saved_searches(db: tauri::State<'_, AppDb>) -> Result<Vec<SavedSearchRow>, String> {
    saved_searches::list(&db.0).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_saved_search(db: tauri::State<'_, AppDb>, id: i64) -> Result<(), String> {
    saved_searches::delete(&db.0, id).await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSavedSearchResult {
    results: Vec<PlaceRow>,
    new_place_ids: Vec<String>,
}

#[tauri::command]
pub async fn run_saved_search(
    db: tauri::State<'_, AppDb>,
    client: tauri::State<'_, PlacesClient>,
    id: i64,
) -> Result<RunSavedSearchResult, String> {
    let api_key = keychain::get_api_key()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No API key configured. Add one in Settings.".to_string())?;

    let (results, new_place_ids) = saved_searches::run(&db.0, &client, &api_key, id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(RunSavedSearchResult { results, new_place_ids })
}

// ---------------------------------------------------------------------
// Email enrichment (from the lead's own website — never Google Maps Content)
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn enrich_lead_emails(
    db: tauri::State<'_, AppDb>,
    lead_id: i64,
) -> Result<Vec<LeadEmailRow>, String> {
    let website = pipeline::get_lead_website(&db.0, lead_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "This lead has no website on file yet. Fetch Place Details for it first.".to_string()
        })?;

    let found = crate::enrichment::enrich_website(&website)
        .await
        .map_err(|e| e.to_string())?;

    pipeline::save_lead_emails(&db.0, lead_id, &found)
        .await
        .map_err(|e| e.to_string())?;

    pipeline::list_lead_emails(&db.0, lead_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_lead_emails(db: tauri::State<'_, AppDb>, lead_id: i64) -> Result<Vec<LeadEmailRow>, String> {
    pipeline::list_lead_emails(&db.0, lead_id).await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// Spend summary (Compliance panel)
// ---------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendSummary {
    month_to_date_usd: f64,
    monthly_cap_usd: f64,
    per_run_call_cap: u32,
}

#[tauri::command]
pub async fn get_spend_summary(db: tauri::State<'_, AppDb>) -> Result<SpendSummary, String> {
    let month_to_date_usd = places::cost::month_to_date_spend_usd(&db.0)
        .await
        .map_err(|e| e.to_string())?;
    let monthly_cap_usd = places::cost::get_monthly_spend_cap_usd(&db.0)
        .await
        .map_err(|e| e.to_string())?;
    let per_run_call_cap = places::cost::get_per_run_call_cap(&db.0)
        .await
        .map_err(|e| e.to_string())?;

    Ok(SpendSummary { month_to_date_usd, monthly_cap_usd, per_run_call_cap })
}

#[tauri::command]
pub async fn set_spend_caps(
    db: tauri::State<'_, AppDb>,
    monthly_cap_usd: f64,
    per_run_call_cap: u32,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('monthly_spend_cap_usd', ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(monthly_cap_usd.to_string())
    .execute(&db.0)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('per_run_call_cap', ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(per_run_call_cap.to_string())
    .execute(&db.0)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}
