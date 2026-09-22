// Fully wired up by Tauri commands added in Phase 5+ (search) and Phase 8
// (Place Details enrichment); until then, most of this module's public
// surface is only exercised by its own unit tests.
#![allow(dead_code, unused_imports)]

pub mod client;
pub mod cost;
pub mod masks;
pub mod rate_limit;
pub mod search;
pub mod store;

pub use client::{
    ClientError, LatLngLiteral, PlaceResult, PlacesClient, RankPreference, SearchResponse,
    Viewport, MAX_PAGE_SIZE, MAX_RESULTS_PER_QUERY,
};
pub use masks::{PlaceMask, MASK_DETAILS_ENTERPRISE, MASK_DISCOVERY, MASK_ID_ONLY};
pub use store::PlaceRow;
