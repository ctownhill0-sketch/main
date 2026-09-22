//! Shared Quick Search execution — used directly by the `quick_search`
//! command and reused when re-running a saved search.

use sqlx::SqlitePool;
use std::time::Duration;

use super::client::{ClientError, PlacesClient, RankPreference};
use super::store;
use super::{MAX_PAGE_SIZE, MAX_RESULTS_PER_QUERY};

/// Runs one Text Search query, paginated up to Google's 60-result cap,
/// persisting every discovered place, and returns the place IDs found.
pub async fn run_quick_search(
    pool: &SqlitePool,
    client: &PlacesClient,
    api_key: &str,
    query: &str,
    rank: Option<RankPreference>,
) -> Result<Vec<String>, ClientError> {
    let mut collected_ids: Vec<String> = Vec::new();
    let mut page_token: Option<String> = None;
    let max_pages = MAX_RESULTS_PER_QUERY / MAX_PAGE_SIZE;

    for page in 0..max_pages {
        if page > 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        let response = client
            .search_text(pool, api_key, query, None, rank, page_token.as_deref())
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

pub fn parse_rank_preference(value: Option<&str>) -> Option<RankPreference> {
    match value {
        Some("DISTANCE") => Some(RankPreference::Distance),
        Some("RELEVANCE") => Some(RankPreference::Relevance),
        _ => None,
    }
}
