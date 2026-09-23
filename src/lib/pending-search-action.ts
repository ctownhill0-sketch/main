import type { RankPreference } from "@/lib/commands";

/**
 * A one-shot handoff for the command palette: it can't safely apply state
 * to QuickSearchForm/DeepSearchForm by dispatching an event right after
 * `navigate()`, since the target form hasn't mounted (and attached a
 * listener) yet at that point — a real race, not a hypothetical one.
 * sessionStorage sidesteps it: the palette writes, navigates, and the
 * newly-mounted form's own `useEffect` reads (and clears) it on mount,
 * whenever that actually happens.
 */
export type PendingSearchAction =
  | { kind: "quick"; query: string; rankPreference?: RankPreference; types: string[] }
  | {
      kind: "deep";
      query: string;
      location: string;
      maxDepth?: number;
      callCap?: number;
      placeType?: string;
    };

const KEY = "leadscout:pendingSearchAction";

export function setPendingSearchAction(action: PendingSearchAction) {
  sessionStorage.setItem(KEY, JSON.stringify(action));
}

/** Reads and clears the pending action — call once, on mount. */
export function takePendingSearchAction(): PendingSearchAction | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  sessionStorage.removeItem(KEY);
  try {
    return JSON.parse(raw) as PendingSearchAction;
  } catch {
    return null;
  }
}
