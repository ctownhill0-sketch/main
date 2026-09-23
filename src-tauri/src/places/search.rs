//! Shared Quick Search execution — used directly by the `quick_search`
//! command and reused when re-running a saved search.

use std::collections::HashSet;
use sqlx::SqlitePool;
use std::time::Duration;

use super::client::{ClientError, PlacesClient, RankPreference};
use super::store;
use super::{MAX_PAGE_SIZE, MAX_RESULTS_PER_QUERY};

/// Runs one Text Search query, paginated up to Google's 60-result cap,
/// persisting every discovered place, and returns the place IDs found.
/// `included_type` is optional structured filtering layered on top of the
/// free-text `query` — see `PlacesClient::search_text`'s doc comment.
pub async fn run_quick_search(
    pool: &SqlitePool,
    client: &PlacesClient,
    api_key: &str,
    query: &str,
    rank: Option<RankPreference>,
    included_type: Option<&str>,
) -> Result<Vec<String>, ClientError> {
    let mut collected_ids: Vec<String> = Vec::new();
    let mut page_token: Option<String> = None;
    let max_pages = MAX_RESULTS_PER_QUERY / MAX_PAGE_SIZE;

    for page in 0..max_pages {
        if page > 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        let response = client
            .search_text(pool, api_key, query, None, rank, page_token.as_deref(), included_type)
            .await?;

        let got_results = !response.places.is_empty();
        for place in &response.places {
            if let Err(e) = store::upsert_discovered_place(pool, place).await {
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

    Ok(collected_ids)
}

/// Runs one `run_quick_search` per selected type, sequentially (queued, not
/// parallel — keeps this predictable against the spend cap), deduping place
/// IDs across types. An empty `types` list falls back to a single
/// free-text-only call, so this is a strict superset of the old behavior.
pub async fn run_multi_type_search(
    pool: &SqlitePool,
    client: &PlacesClient,
    api_key: &str,
    query: &str,
    rank: Option<RankPreference>,
    types: &[String],
) -> Result<Vec<String>, ClientError> {
    if types.is_empty() {
        return run_quick_search(pool, client, api_key, query, rank, None).await;
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut ordered_ids: Vec<String> = Vec::new();

    for included_type in types {
        let ids =
            run_quick_search(pool, client, api_key, query, rank, Some(included_type.as_str()))
                .await?;
        for id in ids {
            if seen.insert(id.clone()) {
                ordered_ids.push(id);
            }
        }
    }

    Ok(ordered_ids)
}

pub fn parse_rank_preference(value: Option<&str>) -> Option<RankPreference> {
    match value {
        Some("DISTANCE") => Some(RankPreference::Distance),
        Some("RELEVANCE") => Some(RankPreference::Relevance),
        _ => None,
    }
}
