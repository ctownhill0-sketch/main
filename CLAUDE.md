# LeadScout — Project Conventions

Desktop lead-gen app (Tauri v2 + React/TS) on the Google Places API (New). Read this
before touching anything that calls Google Places, stores API keys, or caches place data.

## The one rule that matters most

**All Google Places API calls go through the single typed client module at
`src-tauri/src/places/client.rs`. No ad-hoc `fetch`/`reqwest` calls to
`places.googleapis.com` anywhere else — frontend or backend.** Every call must pass one
of the three named field-mask constants below explicitly; never build a mask string by
hand at the call site, and never add a field to a mask without updating this doc.

## Field masks (hard-coded in `src-tauri/src/places/masks.rs`)

| Constant | Fields | Tier / cost (per 1k, 0–100K) |
|---|---|---|
| `MASK_DISCOVERY` | `places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.primaryType,nextPageToken` | Text/Nearby Search **Pro**, $32 |
| `MASK_DETAILS_ENTERPRISE` | `id,displayName,formattedAddress,location,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,regularOpeningHours,businessStatus,googleMapsUri` | Place Details **Enterprise**, $20 — **only** for explicitly kept/selected leads, never bulk |
| `MASK_ID_ONLY` | id-only fields | Essentials, effectively free — refresh/validate place IDs |

Field masks set the price: **you are billed at the highest tier of any field in the
mask.** Never silently add a field to a mask — that can jump the whole call to a more
expensive tier. If a feature needs a new field, name the tier change explicitly in the
PR/commit and update this table.

### Pricing table (verify against Google's live pricing page before relying on it for
real spend decisions: https://developers.google.com/maps/billing-and-pricing/pricing —
verified as of 2026-09-21)

| SKU | Price / 1k calls | Free monthly cap (non-pooling) |
|---|---|---|
| Text/Nearby Search Pro | $32 | 5,000 |
| Text/Nearby Search Enterprise | $35 | 1,000 |
| Text/Nearby Search Enterprise +Atmosphere | $40 | 1,000 |
| Place Details Essentials | $5 | 10,000 |
| Place Details Pro | $17 | 5,000 |
| Place Details Enterprise | $20 | 1,000 |
| Geocoding | $5 | — |

## Compliance rules (Google Maps Platform ToS §3.2.3)

- **Store place IDs indefinitely** — exempt from caching restrictions. Store *our own*
  pipeline data (status, tags, notes, timestamps) indefinitely too.
- **Cache `lat`/`lng` for ≤ 30 days**, then null it out via the cleanup job
  (`src-tauri/src/db.rs`); re-fetch live when needed.
- **Never permanently warehouse other Google Maps Content** (name, phone, website,
  rating, hours). These are cached transiently and re-fetched live via Place Details
  (by stored place ID) when displaying/exporting. Always show a "last refreshed"
  timestamp next to such fields.
- **Show Google attribution** wherever Places content is displayed.
- Emails collected from a business's own website (Phase 9) are our data, not Google Maps
  Content — no caching restriction applies to them.
- There is **no email field** at any Places API tier — email enrichment always comes
  from crawling the business's own site, never from Google.

## Spend guardrails

- Two-phase spend is structural, not just a UI convention: discovery-only commands
  accept `MASK_DISCOVERY`/`MASK_ID_ONLY`; a separate, explicitly-invoked command is the
  only path that can request `MASK_DETAILS_ENTERPRISE`, and it only accepts specific
  lead IDs (no "refresh everything" call).
- Every Places/Geocoding/Aggregate API call is logged to the `api_call_log` SQLite table
  (endpoint, mask, tier, estimated cost, timestamp), success or failure.
- A monthly spend cap and a per-run call cap live in the `settings` table and are
  checked in `places/client.rs` before every batch of calls; hitting either is a hard
  stop, not a warning.
- A build-time/test guard (`src-tauri/src/places/masks.rs`, test
  `only_details_enterprise_mask_may_contain_enterprise_or_atmosphere_fields`) fails
  `cargo test` if any mask string contains an Enterprise/Atmosphere-tier field outside
  `MASK_DETAILS_ENTERPRISE`. Run `cargo test` (in `src-tauri/`) before pushing any change
  that touches a mask constant.

## Secret storage

The Google API key lives in the OS keychain (macOS Keychain / Windows Credential Manager
/ Linux Secret Service) via the Rust `keyring` crate (`src-tauri/src/keychain.rs`).
Never store it in SQLite, `localStorage`, plaintext files, or Tauri config.
