//! SQLite pool setup, migrations, and the compliance cleanup job.
//!
//! Business logic elsewhere in the app (Places client, pipeline, cost log)
//! talks to SQLite through the `sqlx::SqlitePool` set up here. The frontend
//! additionally gets read/write access to the same database file through
//! `@tauri-apps/plugin-sql` for ad-hoc queries (e.g. the results grid).
//! Both point at the same file, so `run_migrations` must complete before the
//! plugin's lazy JS-side connection is used.

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;

/// Wraps the pool so it can be stored in Tauri's managed state.
#[allow(dead_code)] // consumed by commands added in Phase 4+
pub struct AppDb(pub SqlitePool);

pub async fn init_pool(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| sqlx::Error::Io(e))?;
    }

    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}

/// Enforces the 30-day cache limit on lat/lng (Google Maps Platform ToS
/// §3.2.3): place IDs and our own pipeline data are kept forever, but
/// cached coordinates older than 30 days are nulled out. Run once at
/// startup; safe to call repeatedly (no-op when nothing has expired).
pub async fn run_startup_cleanup(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE places SET cached_lat = NULL, cached_lng = NULL, cached_at = NULL \
         WHERE cached_at IS NOT NULL AND cached_at < datetime('now', '-30 days')",
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn migrations_create_expected_tables() {
        let pool = test_pool().await;
        let tables: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let names: Vec<String> = tables.into_iter().map(|(n,)| n).collect();

        for expected in [
            "places",
            "leads",
            "tags",
            "lead_tags",
            "saved_searches",
            "saved_search_seen_places",
            "api_call_log",
            "settings",
        ] {
            assert!(names.contains(&expected.to_string()), "missing table {expected}");
        }
    }

    #[tokio::test]
    async fn default_settings_are_seeded() {
        let pool = test_pool().await;
        let (value,): (String,) =
            sqlx::query_as("SELECT value FROM settings WHERE key = 'monthly_spend_cap_usd'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(value, "50");
    }

    #[tokio::test]
    async fn startup_cleanup_purges_lat_lng_older_than_30_days_but_keeps_the_place_id() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO places (place_id, cached_lat, cached_lng, cached_at) \
             VALUES ('old-place', 1.0, 2.0, datetime('now', '-31 days'))",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO places (place_id, cached_lat, cached_lng, cached_at) \
             VALUES ('fresh-place', 1.0, 2.0, datetime('now', '-1 days'))",
        )
        .execute(&pool)
        .await
        .unwrap();

        let affected = run_startup_cleanup(&pool).await.unwrap();
        assert_eq!(affected, 1);

        let old: (Option<f64>,) =
            sqlx::query_as("SELECT cached_lat FROM places WHERE place_id = 'old-place'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(old.0.is_none(), "expired lat/lng should be purged");

        let old_id_still_present: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM places WHERE place_id = 'old-place'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(old_id_still_present.0, 1, "place_id row must be kept indefinitely");

        let fresh: (Option<f64>,) =
            sqlx::query_as("SELECT cached_lat FROM places WHERE place_id = 'fresh-place'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(fresh.0.is_some(), "lat/lng under 30 days old should be kept");
    }
}
