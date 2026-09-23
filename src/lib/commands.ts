import { invoke } from "@tauri-apps/api/core";

/** Mirrors src-tauri/src/places/store.rs `PlaceRow` (camelCase over the wire). */
export interface PlaceRow {
  placeId: string;
  displayName: string | null;
  formattedAddress: string | null;
  primaryType: string | null;
  businessStatus: string | null;
  lat: number | null;
  lng: number | null;
  discoveredAt: string;
  cachedAt: string | null;
  nationalPhoneNumber: string | null;
  websiteUri: string | null;
  rating: number | null;
  userRatingCount: number | null;
  lastDetailsRefreshedAt: string | null;
  /** Raw regularOpeningHours JSON, only present after a Details fetch. */
  regularOpeningHoursJson: string | null;
}

export type RankPreference = "RELEVANCE" | "DISTANCE";

export interface DeepSearchSummary {
  placeIds: string[];
  tilesScanned: number;
  tilesSubdivided: number;
  callsMade: number;
  estimatedCostUsd: number;
  cancelled: boolean;
  callCapReached: boolean;
  areaFormattedAddress: string;
}

export interface DeepSearchProgressEvent {
  runId: string;
  tilesScanned: number;
  tilesSubdivided: number;
  uniquePlacesFound: number;
  callsMade: number;
  estimatedCostUsd: number;
  done: boolean;
  cancelled: boolean;
  callCapReached: boolean;
}

export interface TagRow {
  id: number;
  name: string;
  color: string | null;
}

export interface LeadRow {
  id: number;
  placeId: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  tags: TagRow[];
  displayName: string | null;
  formattedAddress: string | null;
  primaryType: string | null;
  businessStatus: string | null;
  websiteUri: string | null;
  nationalPhoneNumber: string | null;
  rating: number | null;
}

export interface SavedSearchParams {
  query: string;
  rankPreference: RankPreference | null;
}

export interface SavedSearchRow {
  id: number;
  name: string;
  params: SavedSearchParams;
  createdAt: string;
  lastRunAt: string | null;
}

export interface RunSavedSearchResult {
  results: PlaceRow[];
  newPlaceIds: string[];
}

export interface FailedDetailFetch {
  placeId: string;
  error: string;
}

export interface FetchDetailsResult {
  updated: PlaceRow[];
  failed: FailedDetailFetch[];
}

export interface LeadEmailRow {
  id: number;
  email: string;
  sourceUrl: string;
  fetchedAt: string;
}

export interface SpendSummary {
  monthToDateUsd: number;
  monthlyCapUsd: number;
  perRunCallCap: number;
}

/** Mirrors src-tauri/src/places/client.rs `LatLngLiteral`. */
export interface LatLngLiteral {
  latitude: number;
  longitude: number;
}

/** Mirrors src-tauri/src/places/client.rs `Viewport`. */
export interface Viewport {
  low: LatLngLiteral;
  high: LatLngLiteral;
}

/** Mirrors src-tauri/src/commands.rs `ResolvedLocation`. */
export interface ResolvedLocation {
  formattedAddress: string;
  viewport: Viewport;
  approxWidthKm: number;
  approxHeightKm: number;
}

/** Mirrors src-tauri/src/recent_locations.rs `RecentLocationRow`. */
export interface RecentLocationRow {
  id: number;
  formattedAddress: string;
  lowLat: number;
  lowLng: number;
  highLat: number;
  highLng: number;
  lastUsedAt: string;
  useCount: number;
}

/** Mirrors src-tauri/src/search_history.rs `SearchHistoryRow`. */
export interface SearchHistoryRow {
  id: number;
  kind: "quick" | "deep";
  paramsJson: string;
  resultCount: number;
  ranAt: string;
}

/** Mirrors src-tauri/src/presets.rs `PresetFilters`. */
export interface PresetFilters {
  hasWebsite: boolean | null;
  maxRating: number | null;
  maxReviewCount: number | null;
}

/**
 * Mirrors src-tauri/src/presets.rs `Preset`. `filters` is a suggested
 * Refine-bar starting state — not yet applied anywhere until the Refine bar
 * exists (see refine-bar.tsx).
 */
export interface Preset {
  id: string;
  name: string;
  types: string[];
  suggestedRadiusMeters: number | null;
  description: string;
  filters: PresetFilters | null;
}

/** Typed wrappers over the Tauri command surface (src-tauri/src/commands.rs). */
export const commands = {
  hasApiKey: () => invoke<boolean>("has_api_key"),
  validateAndStoreApiKey: (key: string) =>
    invoke<void>("validate_and_store_api_key", { key }),
  removeApiKey: () => invoke<void>("remove_api_key"),
  quickSearch: (query: string, rankPreference?: RankPreference, types?: string[]) =>
    invoke<PlaceRow[]>("quick_search", { query, rankPreference, types }),
  listPlaces: () => invoke<PlaceRow[]>("list_places"),
  startDeepSearch: (params: {
    runId: string;
    query: string;
    location: string;
    maxDepth?: number;
    callCap?: number;
    placeType?: string;
  }) => invoke<DeepSearchSummary>("start_deep_search", params),
  cancelDeepSearch: (runId: string) => invoke<void>("cancel_deep_search", { runId }),

  addLead: (placeId: string) => invoke<number>("add_lead", { placeId }),
  removeLead: (leadId: number) => invoke<void>("remove_lead", { leadId }),
  updateLeadStatus: (leadId: number, status: string) =>
    invoke<void>("update_lead_status", { leadId, status }),
  updateLeadNotes: (leadId: number, notes: string) =>
    invoke<void>("update_lead_notes", { leadId, notes }),
  listLeads: () => invoke<LeadRow[]>("list_leads"),
  listTags: () => invoke<TagRow[]>("list_tags"),
  createTag: (name: string, color?: string) => invoke<TagRow>("create_tag", { name, color }),
  setLeadTags: (leadId: number, tagIds: number[]) =>
    invoke<void>("set_lead_tags", { leadId, tagIds }),
  getLeadStatuses: () => invoke<string[]>("get_lead_statuses"),
  setLeadStatuses: (statuses: string[]) => invoke<void>("set_lead_statuses", { statuses }),

  saveSearch: (name: string, query: string, rankPreference?: RankPreference) =>
    invoke<number>("save_search", { name, query, rankPreference }),
  listSavedSearches: () => invoke<SavedSearchRow[]>("list_saved_searches"),
  deleteSavedSearch: (id: number) => invoke<void>("delete_saved_search", { id }),
  runSavedSearch: (id: number) => invoke<RunSavedSearchResult>("run_saved_search", { id }),
  fetchPlaceDetails: (placeIds: string[]) =>
    invoke<FetchDetailsResult>("fetch_place_details", { placeIds }),

  enrichLeadEmails: (leadId: number) => invoke<LeadEmailRow[]>("enrich_lead_emails", { leadId }),
  listLeadEmails: (leadId: number) => invoke<LeadEmailRow[]>("list_lead_emails", { leadId }),

  getSpendSummary: () => invoke<SpendSummary>("get_spend_summary"),
  setSpendCaps: (monthlyCapUsd: number, perRunCallCap: number) =>
    invoke<void>("set_spend_caps", { monthlyCapUsd, perRunCallCap }),

  listPresets: () => invoke<Preset[]>("list_presets"),
  savePreset: (preset: Preset) => invoke<void>("save_preset", { preset }),
  deletePreset: (id: string) => invoke<void>("delete_preset", { id }),

  resolveLocation: (location: string) =>
    invoke<ResolvedLocation>("resolve_location", { location }),
  listRecentLocations: () => invoke<RecentLocationRow[]>("list_recent_locations"),
  deleteRecentLocation: (id: number) => invoke<void>("delete_recent_location", { id }),

  listSearchHistory: () => invoke<SearchHistoryRow[]>("list_search_history"),
};

/** Tauri command errors are rejected with a plain string message. */
export function commandErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
