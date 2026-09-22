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

/** Typed wrappers over the Tauri command surface (src-tauri/src/commands.rs). */
export const commands = {
  hasApiKey: () => invoke<boolean>("has_api_key"),
  validateAndStoreApiKey: (key: string) =>
    invoke<void>("validate_and_store_api_key", { key }),
  removeApiKey: () => invoke<void>("remove_api_key"),
  quickSearch: (query: string, rankPreference?: RankPreference) =>
    invoke<PlaceRow[]>("quick_search", { query, rankPreference }),
  listPlaces: () => invoke<PlaceRow[]>("list_places"),
  startDeepSearch: (params: {
    runId: string;
    query: string;
    location: string;
    maxDepth?: number;
    callCap?: number;
  }) => invoke<DeepSearchSummary>("start_deep_search", params),
  cancelDeepSearch: (runId: string) => invoke<void>("cancel_deep_search", { runId }),
};

/** Tauri command errors are rejected with a plain string message. */
export function commandErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
