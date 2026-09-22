//! Pricing table and cost estimator/spend-cap checks.
//!
//! Prices verified against https://developers.google.com/maps/billing-and-pricing/pricing
//! as of 2026-09-21 — re-check before relying on this for real spend decisions;
//! these SKUs change. Mirrored in `src/lib/cost.ts` for the frontend's live
//! cost display.

use sqlx::SqlitePool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    SearchPro,
    SearchEnterprise,
    SearchEnterpriseAtmosphere,
    DetailsEssentials,
    DetailsPro,
    DetailsEnterprise,
    Geocoding,
}

impl Tier {
    pub fn price_per_1000_usd(&self) -> f64 {
        match self {
            Tier::SearchPro => 32.0,
            Tier::SearchEnterprise => 35.0,
            Tier::SearchEnterpriseAtmosphere => 40.0,
            Tier::DetailsEssentials => 5.0,
            Tier::DetailsPro => 17.0,
            Tier::DetailsEnterprise => 20.0,
            Tier::Geocoding => 5.0,
        }
    }

    pub fn cost_per_call_usd(&self) -> f64 {
        self.price_per_1000_usd() / 1000.0
    }

    /// Free monthly call allowance (non-pooling). `None` means no published
    /// free tier for this SKU.
    pub fn free_monthly_cap(&self) -> Option<u32> {
        match self {
            Tier::SearchPro => Some(5_000),
            Tier::SearchEnterprise | Tier::SearchEnterpriseAtmosphere => Some(1_000),
            Tier::DetailsEssentials => Some(10_000),
            Tier::DetailsPro => Some(5_000),
            Tier::DetailsEnterprise => Some(1_000),
            Tier::Geocoding => None,
        }
    }
}

pub fn estimate_cost_usd(tier: Tier, num_calls: u32) -> f64 {
    tier.cost_per_call_usd() * num_calls as f64
}

#[derive(Debug, thiserror::Error)]
pub enum CostError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

pub async fn month_to_date_spend_usd(pool: &SqlitePool) -> Result<f64, CostError> {
    let (total,): (Option<f64>,) = sqlx::query_as(
        "SELECT SUM(estimated_cost_usd) FROM api_call_log \
         WHERE called_at >= strftime('%Y-%m-01', 'now')",
    )
    .fetch_one(pool)
    .await?;

    Ok(total.unwrap_or(0.0))
}

pub async fn get_setting_f64(pool: &SqlitePool, key: &str, default: f64) -> Result<f64, CostError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;

    Ok(row
        .and_then(|(v,)| v.parse::<f64>().ok())
        .unwrap_or(default))
}

pub async fn get_monthly_spend_cap_usd(pool: &SqlitePool) -> Result<f64, CostError> {
    get_setting_f64(pool, "monthly_spend_cap_usd", f64::MAX).await
}

pub async fn get_per_run_call_cap(pool: &SqlitePool) -> Result<u32, CostError> {
    Ok(get_setting_f64(pool, "per_run_call_cap", u32::MAX as f64).await? as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cost_per_call_matches_the_published_per_1000_price() {
        assert!((Tier::SearchPro.cost_per_call_usd() - 0.032).abs() < 1e-9);
        assert!((Tier::DetailsEnterprise.cost_per_call_usd() - 0.020).abs() < 1e-9);
        assert!((Tier::Geocoding.cost_per_call_usd() - 0.005).abs() < 1e-9);
    }

    #[test]
    fn estimate_cost_scales_linearly_with_call_count() {
        // 60 discovery calls (the Deep Search hard cap's worth of pagination)
        assert!((estimate_cost_usd(Tier::SearchPro, 60) - 1.92).abs() < 1e-9);
        assert_eq!(estimate_cost_usd(Tier::DetailsEnterprise, 0), 0.0);
    }

    #[test]
    fn free_caps_match_the_published_non_pooling_allowances() {
        assert_eq!(Tier::DetailsEssentials.free_monthly_cap(), Some(10_000));
        assert_eq!(Tier::SearchPro.free_monthly_cap(), Some(5_000));
        assert_eq!(Tier::DetailsEnterprise.free_monthly_cap(), Some(1_000));
        assert_eq!(Tier::Geocoding.free_monthly_cap(), None);
    }

    async fn seeded_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn month_to_date_spend_sums_only_this_calendar_month() {
        let pool = seeded_pool().await;
        sqlx::query(
            "INSERT INTO api_call_log (endpoint, mask_name, tier, estimated_cost_usd, success, called_at) \
             VALUES ('searchText', 'MASK_DISCOVERY', 'SearchPro', 1.50, 1, datetime('now'))",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO api_call_log (endpoint, mask_name, tier, estimated_cost_usd, success, called_at) \
             VALUES ('searchText', 'MASK_DISCOVERY', 'SearchPro', 99.0, 1, datetime('now', '-2 months'))",
        )
        .execute(&pool)
        .await
        .unwrap();

        let spend = month_to_date_spend_usd(&pool).await.unwrap();
        assert!((spend - 1.50).abs() < 1e-9, "expected only this month's spend, got {spend}");
    }

    #[tokio::test]
    async fn monthly_spend_cap_reads_the_seeded_default() {
        let pool = seeded_pool().await;
        let cap = get_monthly_spend_cap_usd(&pool).await.unwrap();
        assert_eq!(cap, 50.0);
    }
}
