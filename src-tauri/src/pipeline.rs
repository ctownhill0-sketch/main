//! Lead pipeline: statuses, freeform tags, and notes attached to a place a
//! user has explicitly chosen to track. Distinct from `places` (every
//! discovered place) — a row here only exists once a place is added to the
//! pipeline.

use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize, Clone)]
pub struct TagRow {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LeadRow {
    pub id: i64,
    pub place_id: String,
    pub status: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<TagRow>,
    pub display_name: Option<String>,
    pub formatted_address: Option<String>,
    pub primary_type: Option<String>,
    pub business_status: Option<String>,
    pub website_uri: Option<String>,
    pub national_phone_number: Option<String>,
    pub rating: Option<f64>,
}

const DEFAULT_STATUS: &str = "New";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LeadEmailRow {
    pub id: i64,
    pub email: String,
    pub source_url: String,
    pub fetched_at: String,
}

/// The website URL to crawl for this lead, if Place Details has been
/// fetched and returned one. `None` means enrichment can't run yet.
pub async fn get_lead_website(pool: &SqlitePool, lead_id: i64) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT p.website_uri FROM leads l JOIN places p ON p.place_id = l.place_id WHERE l.id = ?",
    )
    .bind(lead_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(w,)| w))
}

pub async fn save_lead_emails(
    pool: &SqlitePool,
    lead_id: i64,
    emails: &[crate::enrichment::FoundEmail],
) -> Result<(), sqlx::Error> {
    for e in emails {
        sqlx::query(
            "INSERT INTO lead_emails (lead_id, email, source_url) VALUES (?, ?, ?) \
             ON CONFLICT(lead_id, email) DO UPDATE SET \
               source_url = excluded.source_url, fetched_at = datetime('now')",
        )
        .bind(lead_id)
        .bind(&e.email)
        .bind(&e.source_url)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn list_lead_emails(pool: &SqlitePool, lead_id: i64) -> Result<Vec<LeadEmailRow>, sqlx::Error> {
    let rows: Vec<(i64, String, String, String)> = sqlx::query_as(
        "SELECT id, email, source_url, fetched_at FROM lead_emails WHERE lead_id = ? ORDER BY fetched_at DESC",
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, email, source_url, fetched_at)| LeadEmailRow { id, email, source_url, fetched_at })
        .collect())
}

/// Adds a place to the pipeline if it isn't already there; a no-op
/// (keeping the existing status/notes/tags) if it is. Returns the lead id
/// either way.
pub async fn add_lead(pool: &SqlitePool, place_id: &str) -> Result<i64, sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO leads (place_id, status) VALUES (?, ?)")
        .bind(place_id)
        .bind(DEFAULT_STATUS)
        .execute(pool)
        .await?;

    let (id,): (i64,) = sqlx::query_as("SELECT id FROM leads WHERE place_id = ?")
        .bind(place_id)
        .fetch_one(pool)
        .await?;
    Ok(id)
}

pub async fn remove_lead(pool: &SqlitePool, lead_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM leads WHERE id = ?")
        .bind(lead_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_status(pool: &SqlitePool, lead_id: i64, status: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(status)
        .bind(lead_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_notes(pool: &SqlitePool, lead_id: i64, notes: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE leads SET notes = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(notes)
        .bind(lead_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_tags(pool: &SqlitePool) -> Result<Vec<TagRow>, sqlx::Error> {
    let rows: Vec<(i64, String, Option<String>)> =
        sqlx::query_as("SELECT id, name, color FROM tags ORDER BY name")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(id, name, color)| TagRow { id, name, color })
        .collect())
}

pub async fn create_tag(pool: &SqlitePool, name: &str, color: Option<&str>) -> Result<TagRow, sqlx::Error> {
    sqlx::query("INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color")
        .bind(name)
        .bind(color)
        .execute(pool)
        .await?;

    let (id, name, color): (i64, String, Option<String>) =
        sqlx::query_as("SELECT id, name, color FROM tags WHERE name = ?")
            .bind(name)
            .fetch_one(pool)
            .await?;
    Ok(TagRow { id, name, color })
}

pub async fn set_lead_tags(pool: &SqlitePool, lead_id: i64, tag_ids: &[i64]) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM lead_tags WHERE lead_id = ?")
        .bind(lead_id)
        .execute(&mut *tx)
        .await?;
    for tag_id in tag_ids {
        sqlx::query("INSERT INTO lead_tags (lead_id, tag_id) VALUES (?, ?)")
            .bind(lead_id)
            .bind(tag_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct LeadRowSql {
    id: i64,
    place_id: String,
    status: String,
    notes: String,
    created_at: String,
    updated_at: String,
    display_name: Option<String>,
    formatted_address: Option<String>,
    primary_type: Option<String>,
    business_status: Option<String>,
    website_uri: Option<String>,
    national_phone_number: Option<String>,
    rating: Option<f64>,
}

pub async fn list_leads(pool: &SqlitePool) -> Result<Vec<LeadRow>, sqlx::Error> {
    let rows: Vec<LeadRowSql> = sqlx::query_as(
        "SELECT l.id, l.place_id, l.status, l.notes, l.created_at, l.updated_at, \
                p.display_name, p.formatted_address, p.primary_type, p.business_status, \
                p.website_uri, p.national_phone_number, p.rating \
         FROM leads l JOIN places p ON p.place_id = l.place_id \
         ORDER BY l.updated_at DESC",
    )
    .fetch_all(pool)
    .await?;

    let tag_rows: Vec<(i64, i64, String, Option<String>)> = sqlx::query_as(
        "SELECT lt.lead_id, t.id, t.name, t.color FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id",
    )
    .fetch_all(pool)
    .await?;

    let mut leads = Vec::with_capacity(rows.len());
    for r in rows {
        let tags = tag_rows
            .iter()
            .filter(|(lead_id, ..)| *lead_id == r.id)
            .map(|(_, id, name, color)| TagRow { id: *id, name: name.clone(), color: color.clone() })
            .collect();

        leads.push(LeadRow {
            id: r.id,
            place_id: r.place_id,
            status: r.status,
            notes: r.notes,
            created_at: r.created_at,
            updated_at: r.updated_at,
            tags,
            display_name: r.display_name,
            formatted_address: r.formatted_address,
            primary_type: r.primary_type,
            business_status: r.business_status,
            website_uri: r.website_uri,
            national_phone_number: r.national_phone_number,
            rating: r.rating,
        });
    }
    Ok(leads)
}

pub async fn get_lead_statuses(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'lead_statuses'")
        .fetch_optional(pool)
        .await?;
    Ok(row
        .and_then(|(v,)| serde_json::from_str(&v).ok())
        .unwrap_or_else(|| vec!["New".to_string()]))
}

pub async fn set_lead_statuses(pool: &SqlitePool, statuses: &[String]) -> Result<(), sqlx::Error> {
    let json = serde_json::to_string(statuses).unwrap_or_else(|_| "[]".to_string());
    sqlx::query("INSERT INTO settings (key, value) VALUES ('lead_statuses', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(json)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::places::client::{LatLngLiteral, LocalizedText, PlaceResult};
    use crate::places::store::upsert_discovered_place;

    async fn seeded_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn seed_place(pool: &SqlitePool, id: &str, name: &str) {
        let place = PlaceResult {
            id: Some(id.to_string()),
            display_name: Some(LocalizedText { text: name.to_string() }),
            location: Some(LatLngLiteral { latitude: 1.0, longitude: 2.0 }),
            ..Default::default()
        };
        upsert_discovered_place(pool, &place).await.unwrap();
    }

    #[tokio::test]
    async fn adding_the_same_place_twice_does_not_duplicate_or_reset_the_lead() {
        let pool = seeded_pool().await;
        seed_place(&pool, "p1", "Cafe").await;

        let id1 = add_lead(&pool, "p1").await.unwrap();
        update_status(&pool, id1, "Qualified").await.unwrap();
        let id2 = add_lead(&pool, "p1").await.unwrap();

        assert_eq!(id1, id2);
        let leads = list_leads(&pool).await.unwrap();
        assert_eq!(leads.len(), 1);
        assert_eq!(leads[0].status, "Qualified", "re-adding must not reset status");
    }

    #[tokio::test]
    async fn tags_can_be_set_and_are_returned_with_the_lead() {
        let pool = seeded_pool().await;
        seed_place(&pool, "p1", "Cafe").await;
        let lead_id = add_lead(&pool, "p1").await.unwrap();

        let hot = create_tag(&pool, "hot-lead", Some("#ff0000")).await.unwrap();
        let vip = create_tag(&pool, "vip", None).await.unwrap();
        set_lead_tags(&pool, lead_id, &[hot.id, vip.id]).await.unwrap();

        let leads = list_leads(&pool).await.unwrap();
        let tag_names: Vec<_> = leads[0].tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(tag_names.len(), 2);
        assert!(tag_names.contains(&"hot-lead"));
        assert!(tag_names.contains(&"vip"));
    }

    #[tokio::test]
    async fn removing_a_lead_does_not_delete_the_underlying_place() {
        let pool = seeded_pool().await;
        seed_place(&pool, "p1", "Cafe").await;
        let lead_id = add_lead(&pool, "p1").await.unwrap();
        remove_lead(&pool, lead_id).await.unwrap();

        assert!(list_leads(&pool).await.unwrap().is_empty());
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM places WHERE place_id = 'p1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "place_id must be kept even after removing the lead");
    }

    #[tokio::test]
    async fn default_lead_statuses_are_seeded() {
        let pool = seeded_pool().await;
        let statuses = get_lead_statuses(&pool).await.unwrap();
        assert_eq!(statuses, vec!["New", "Contacted", "Qualified", "Won", "Lost"]);
    }

    #[tokio::test]
    async fn lead_statuses_can_be_edited() {
        let pool = seeded_pool().await;
        set_lead_statuses(&pool, &["New".to_string(), "Closed".to_string()]).await.unwrap();
        let statuses = get_lead_statuses(&pool).await.unwrap();
        assert_eq!(statuses, vec!["New", "Closed"]);
    }

    #[tokio::test]
    async fn lead_website_is_none_until_place_details_have_been_fetched() {
        let pool = seeded_pool().await;
        seed_place(&pool, "p1", "Cafe").await;
        let lead_id = add_lead(&pool, "p1").await.unwrap();

        assert_eq!(get_lead_website(&pool, lead_id).await.unwrap(), None);

        sqlx::query("UPDATE places SET website_uri = ? WHERE place_id = 'p1'")
            .bind("https://example.com")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            get_lead_website(&pool, lead_id).await.unwrap(),
            Some("https://example.com".to_string())
        );
    }

    #[tokio::test]
    async fn saving_emails_twice_updates_fetched_at_instead_of_duplicating() {
        let pool = seeded_pool().await;
        seed_place(&pool, "p1", "Cafe").await;
        let lead_id = add_lead(&pool, "p1").await.unwrap();

        let emails = vec![crate::enrichment::FoundEmail {
            email: "info@example.com".to_string(),
            source_url: "https://example.com".to_string(),
        }];
        save_lead_emails(&pool, lead_id, &emails).await.unwrap();
        save_lead_emails(&pool, lead_id, &emails).await.unwrap();

        let rows = list_lead_emails(&pool, lead_id).await.unwrap();
        assert_eq!(rows.len(), 1, "the same email must not be duplicated");
        assert_eq!(rows[0].email, "info@example.com");
    }
}
