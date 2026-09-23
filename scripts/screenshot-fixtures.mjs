// Fixture responses for scripts/screenshot.mjs's fake Tauri IPC, keyed by
// command name exactly as invoked from the frontend (src/lib/commands.ts).
const samplePlaces = [
  {
    placeId: "p1",
    displayName: "Riverside Coffee Roasters",
    formattedAddress: "412 Congress Ave, Austin, TX 78701",
    primaryType: "cafe",
    businessStatus: "OPERATIONAL",
    lat: 30.2672,
    lng: -97.7431,
    discoveredAt: "2026-09-20T14:00:00Z",
    cachedAt: "2026-09-21T09:00:00Z",
    nationalPhoneNumber: "(512) 555-0142",
    websiteUri: "https://example.com",
    rating: 4.6,
    userRatingCount: 812,
    lastDetailsRefreshedAt: "2026-09-21T09:00:00Z",
  },
  {
    placeId: "p2",
    displayName: "Downtown Plumbing Co",
    formattedAddress: "88 E 5th St, Austin, TX 78701",
    primaryType: "plumber",
    businessStatus: "OPERATIONAL",
    lat: 30.2669,
    lng: -97.7428,
    discoveredAt: "2026-09-20T14:00:05Z",
    cachedAt: "2026-09-21T09:00:05Z",
    nationalPhoneNumber: null,
    websiteUri: null,
    rating: 3.9,
    userRatingCount: 54,
    lastDetailsRefreshedAt: "2026-09-21T09:00:05Z",
  },
  {
    placeId: "p3",
    displayName: "Sixth Street Diner",
    formattedAddress: "215 6th St, Austin, TX 78701",
    primaryType: "restaurant",
    businessStatus: "CLOSED_TEMPORARILY",
    lat: 30.2674,
    lng: -97.7404,
    discoveredAt: "2026-09-20T14:00:10Z",
    cachedAt: null,
    nationalPhoneNumber: null,
    websiteUri: null,
    rating: null,
    userRatingCount: null,
    lastDetailsRefreshedAt: null,
  },
];

const sampleTags = [
  { id: 1, name: "hot-lead", color: "#ff0000" },
  { id: 2, name: "vip", color: null },
];

const sampleLeads = [
  {
    id: 1,
    placeId: "p1",
    status: "New",
    notes: "Met at trade show, interested in bulk orders.",
    createdAt: "2026-09-20T14:00:00Z",
    updatedAt: "2026-09-20T14:00:00Z",
    tags: [sampleTags[0]],
    displayName: "Riverside Coffee Roasters",
    formattedAddress: "412 Congress Ave, Austin, TX 78701",
    primaryType: "cafe",
    businessStatus: "OPERATIONAL",
    websiteUri: "https://example.com",
    nationalPhoneNumber: "(512) 555-0142",
    rating: 4.6,
  },
  {
    id: 2,
    placeId: "p2",
    status: "Contacted",
    notes: "",
    createdAt: "2026-09-20T14:05:00Z",
    updatedAt: "2026-09-21T09:00:00Z",
    tags: [sampleTags[0], sampleTags[1]],
    displayName: "Downtown Plumbing Co",
    formattedAddress: "88 E 5th St, Austin, TX 78701",
    primaryType: "plumber",
    businessStatus: "OPERATIONAL",
    websiteUri: null,
    nationalPhoneNumber: null,
    rating: 3.9,
  },
  {
    id: 3,
    placeId: "p3",
    status: "Qualified",
    notes: "",
    createdAt: "2026-09-19T14:05:00Z",
    updatedAt: "2026-09-19T14:05:00Z",
    tags: [],
    displayName: "Sixth Street Diner",
    formattedAddress: "215 6th St, Austin, TX 78701",
    primaryType: "restaurant",
    businessStatus: "CLOSED_TEMPORARILY",
    websiteUri: null,
    nationalPhoneNumber: null,
    rating: null,
  },
];

const sampleSavedSearches = [
  {
    id: 1,
    name: "Austin coffee shops",
    params: { query: "coffee shops in Austin, TX", rankPreference: null },
    createdAt: "2026-09-18T10:00:00Z",
    lastRunAt: "2026-09-21T09:00:00Z",
  },
];

const sampleLeadEmails = [
  {
    id: 1,
    email: "info@riversidecoffee.example",
    sourceUrl: "https://example.com/contact",
    fetchedAt: "2026-09-21T09:10:00Z",
  },
];

const samplePresets = [
  {
    id: "contractors-no-website",
    name: "Contractors with no website",
    types: ["general_contractor", "roofing_contractor", "electrician", "plumber", "hvac_contractor"],
    suggestedRadiusMeters: 24000,
    description: "Home-service contractors are often small operations without a web presence.",
    filters: { hasWebsite: false, maxRating: null, maxReviewCount: null },
  },
  {
    id: "restaurants-under-4",
    name: "Restaurants rated under 4.0",
    types: ["restaurant"],
    suggestedRadiusMeters: 8000,
    description: "Restaurants with room to improve their online reputation.",
    filters: { hasWebsite: null, maxRating: 4.0, maxReviewCount: null },
  },
];

const sampleRecentLocations = [
  {
    id: 1,
    formattedAddress: "Austin, TX, USA",
    lowLat: 30.098,
    lowLng: -97.938,
    highLat: 30.517,
    highLng: -97.561,
    lastUsedAt: "2026-09-21T09:00:00Z",
    useCount: 3,
  },
  {
    id: 2,
    formattedAddress: "Denver, CO, USA",
    lowLat: 39.614,
    lowLng: -105.109,
    highLat: 39.914,
    highLng: -104.6,
    lastUsedAt: "2026-09-18T09:00:00Z",
    useCount: 1,
  },
];

export const fixtures = {
  has_api_key: true,
  list_places: samplePlaces,
  quick_search: samplePlaces,
  list_leads: sampleLeads,
  list_tags: sampleTags,
  get_lead_statuses: ["New", "Contacted", "Qualified", "Won", "Lost"],
  list_saved_searches: sampleSavedSearches,
  list_lead_emails: sampleLeadEmails,
  get_spend_summary: { monthToDateUsd: 4.32, monthlyCapUsd: 50, perRunCallCap: 200 },
  list_presets: samplePresets,
  list_recent_locations: sampleRecentLocations,
  resolve_location: {
    formattedAddress: "Austin, TX, USA",
    viewport: { low: { latitude: 30.098, longitude: -97.938 }, high: { latitude: 30.517, longitude: -97.561 } },
    approxWidthKm: 36,
    approxHeightKm: 46,
  },
};
