import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ClockIcon,
  InfoIcon,
  KanbanIcon,
  PlusIcon,
  SaveIcon,
  SearchCheckIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TableIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  commands,
  commandErrorMessage,
  type Preset,
  type RankPreference,
  type SearchHistoryRow,
  type SavedSearchRow,
} from "@/lib/commands";
import { setPendingSearchAction } from "@/lib/pending-search-action";

const ROUTES = [
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/results", label: "Results", icon: TableIcon },
  { to: "/pipeline", label: "Pipeline", icon: KanbanIcon },
  { to: "/compliance", label: "Compliance", icon: ShieldCheckIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/about", label: "About", icon: InfoIcon },
] as const;

interface QuickHistoryParams {
  query: string;
  rankPreference: RankPreference | null;
  types: string[];
}

interface DeepHistoryParams {
  query: string;
  location: string;
  maxDepth: number | null;
  callCap: number | null;
  placeType: string | null;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [history, setHistory] = useState<SearchHistoryRow[] | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Lazy-load on open, not on every keystroke — the route list is static
  // and needs no fetch, but these three groups do.
  useEffect(() => {
    if (!open) return;
    if (presets === null) commands.listPresets().then(setPresets).catch(() => setPresets([]));
    if (history === null) commands.listSearchHistory().then(setHistory).catch(() => setHistory([]));
    if (savedSearches === null) {
      commands.listSavedSearches().then(setSavedSearches).catch(() => setSavedSearches([]));
    }
  }, [open, presets, history, savedSearches]);

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  function applyPreset(preset: Preset) {
    setPendingSearchAction({ kind: "quick", query: "", types: preset.types });
    go("/search?tab=quick");
  }

  function applyHistoryRow(row: SearchHistoryRow) {
    try {
      if (row.kind === "quick") {
        const p: QuickHistoryParams = JSON.parse(row.paramsJson);
        setPendingSearchAction({
          kind: "quick",
          query: p.query,
          rankPreference: p.rankPreference ?? undefined,
          types: p.types ?? [],
        });
        go("/search?tab=quick");
      } else {
        const p: DeepHistoryParams = JSON.parse(row.paramsJson);
        setPendingSearchAction({
          kind: "deep",
          query: p.query,
          location: p.location,
          maxDepth: p.maxDepth ?? undefined,
          callCap: p.callCap ?? undefined,
          placeType: p.placeType ?? undefined,
        });
        go("/search?tab=deep");
      }
    } catch {
      go(row.kind === "quick" ? "/search?tab=quick" : "/search?tab=deep");
    }
  }

  async function runSavedSearch(s: SavedSearchRow) {
    setOpen(false);
    try {
      const { results, newPlaceIds } = await commands.runSavedSearch(s.id);
      toast.success(
        newPlaceIds.length > 0
          ? `${results.length} results, ${newPlaceIds.length} new since last run.`
          : `${results.length} results — no new places since last run.`,
      );
      navigate(`/results?new=${encodeURIComponent(newPlaceIds.join(","))}`);
    } catch (err) {
      toast.error(commandErrorMessage(err));
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, presets, or actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {ROUTES.map(({ to, label, icon: Icon }) => (
            <CommandItem key={to} value={label} onSelect={() => go(to)}>
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="New Quick Search" onSelect={() => go("/search?tab=quick")}>
            <PlusIcon />
            New Quick Search
          </CommandItem>
          <CommandItem value="New Deep Search" onSelect={() => go("/search?tab=deep")}>
            <SearchCheckIcon />
            New Deep Search
          </CommandItem>
        </CommandGroup>
        {presets && presets.length > 0 && (
          <CommandGroup heading="Presets">
            {presets.map((p) => (
              <CommandItem key={p.id} value={`preset ${p.name}`} onSelect={() => applyPreset(p)}>
                <SparklesIcon />
                {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {savedSearches && savedSearches.length > 0 && (
          <CommandGroup heading="Saved searches">
            {savedSearches.map((s) => (
              <CommandItem
                key={s.id}
                value={`saved search ${s.name}`}
                onSelect={() => runSavedSearch(s)}
              >
                <SaveIcon />
                {s.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {history && history.length > 0 && (
          <CommandGroup heading="Recent searches">
            {history.slice(0, 8).map((h) => (
              <CommandItem
                key={h.id}
                value={`recent search ${h.id} ${h.kind}`}
                onSelect={() => applyHistoryRow(h)}
              >
                <ClockIcon />
                {h.kind === "quick" ? "Quick" : "Deep"} search · {h.resultCount} results
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
