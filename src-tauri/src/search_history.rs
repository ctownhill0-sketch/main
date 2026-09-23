//! Auto-recorded search history — last 20 searches, oldest evicted, for the
//! search surface's "recent searches" list. `params_json` is opaque here
//! (the frontend already knows the shape per `kind` from what it just sent
//! to `quick_search`/`start_deep_search`); there is no dedicated "rerun"
//! command — replaying history just re-invokes those same commands with the
//! parsed params.

use serde::Serialize;
use sqlx::SqlitePool;

const MAX_HISTORY: i64 = 20;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHistoryRow {
    pub id: i64,
    pub kind: String,
    pub params_json: String,
    pub result_count: i64,
    pub ran_at: String,
}

pub async fn record(
    pool: &SqlitePool,
    kind: &str,
    params_json: &str,
    result_count: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO search_history (kind, params_json, result_count) VALUES (?, ?, ?)")
        .bind(kind)
        .bind(params_json)
        .bind(result_count)
        .execute(pool)
        .await?;

    sqlx::query(
        "DELETE FROM search_history WHERE id NOT IN \
         (SELECT id FROM search_history ORDER BY ran_at DESC LIMIT ?)",
    )
    .bind(MAX_HISTORY)
    .execute(pool)
    .await?;

    Ok(())
}

type SearchHistoryTuple = (i64, String, String, i64, String);

pub async fn list(pool: &SqlitePool) -> Result<Vec<SearchHistoryRow>, sqlx::Error> {
    let rows: Vec<SearchHistoryTuple> = sqlx::query_as(
        "SELECT id, kind, params_json, result_count, ran_at FROM search_history ORDER BY ran_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, kind, params_json, result_count, ran_at)| SearchHistoryRow {
            id,
            kind,
            params_json,
            result_count,
            ran_at,
        })
        .collect())
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
    async fn eviction_keeps_only_the_20_most_recent() {
        let pool = seeded_pool().await;
        for i in 0..25 {
            record(&pool, "quick", &format!("{{\"query\":\"q{i}\"}}"), i).await.unwrap();
        }

        let rows = list(&pool).await.unwrap();
        assert_eq!(rows.len(), 20, "eviction must cap at 20 rows");
        assert!(!rows.iter().any(|r| r.params_json.contains("q0")));
        assert!(rows.iter().any(|r| r.params_json.contains("q24")));
    }

    #[tokio::test]
    async fn records_round_trip_kind_and_result_count() {
        let pool = seeded_pool().await;
        record(&pool, "deep", "{\"query\":\"coffee\"}", 42).await.unwrap();
        let rows = list(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, "deep");
        assert_eq!(rows[0].result_count, 42);
    }
}
