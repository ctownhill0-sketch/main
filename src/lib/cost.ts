/**
 * Mirrors src-tauri/src/places/cost.rs — kept in sync by hand. Used for
 * live cost estimates in the UI (e.g. the Deep Search confirmation modal);
 * the Rust side is the source of truth that actually enforces spend caps.
 *
 * Prices verified against https://developers.google.com/maps/billing-and-pricing/pricing
 * as of 2026-09-21 — re-check before relying on this for real spend decisions.
 */

export type Tier =
  | "SearchPro"
  | "SearchEnterprise"
  | "SearchEnterpriseAtmosphere"
  | "DetailsEssentials"
  | "DetailsPro"
  | "DetailsEnterprise"
  | "Geocoding";

export const PRICE_PER_1000_USD: Record<Tier, number> = {
  SearchPro: 32,
  SearchEnterprise: 35,
  SearchEnterpriseAtmosphere: 40,
  DetailsEssentials: 5,
  DetailsPro: 17,
  DetailsEnterprise: 20,
  Geocoding: 5,
};

export const FREE_MONTHLY_CAP: Record<Tier, number | null> = {
  SearchPro: 5000,
  SearchEnterprise: 1000,
  SearchEnterpriseAtmosphere: 1000,
  DetailsEssentials: 10000,
  DetailsPro: 5000,
  DetailsEnterprise: 1000,
  Geocoding: null,
};

export function costPerCallUsd(tier: Tier): number {
  return PRICE_PER_1000_USD[tier] / 1000;
}

export function estimateCostUsd(tier: Tier, numCalls: number): number {
  return costPerCallUsd(tier) * numCalls;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount < 1 ? 3 : 2,
    maximumFractionDigits: amount < 1 ? 3 : 2,
  }).format(amount);
}
