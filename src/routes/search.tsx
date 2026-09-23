import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2Icon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeepSearchForm } from "@/components/search/deep-search-form";
import { SaveSearchButton, SavedSearchesPanel } from "@/components/search/saved-searches-panel";
import { PresetsDropdown, SavePresetButton } from "@/components/search/presets-dropdown";
import { TypeCombobox } from "@/components/search/type-combobox";
import { commands, commandErrorMessage, type Preset, type RankPreference } from "@/lib/commands";
import { estimateCostUsd, formatUsd } from "@/lib/cost";

function QuickSearchForm() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [rankPreference, setRankPreference] = useState<RankPreference | "">("");
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const worstCaseCostUsd = estimateCostUsd("SearchPro", 3 * Math.max(1, types.length));

  function handleApplyPreset(preset: Preset) {
    setTypes(preset.types);
    toast.success(`Applied "${preset.name}".`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSearching(true);
    try {
      const results = await commands.quickSearch(
        query,
        rankPreference === "" ? undefined : rankPreference,
        types.length > 0 ? types : undefined,
      );
      toast.success(
        `Found ${results.length} place${results.length === 1 ? "" : "s"}.${
          results.length >= 60 ? " Hit the 60-result cap — try Deep Search for more." : ""
        }`,
      );
      navigate("/results");
    } catch (err) {
      setError(commandErrorMessage(err));
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <SearchIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm">Search Google Places</CardTitle>
        </div>
        <CardDescription>
          Combine business type and location in one query, the way you would on
          Google Maps — e.g. "plumbers in Denver, CO" or "coffee shops near
          downtown Austin". Returns up to 60 results (3 pages of 20).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <PresetsDropdown onApply={handleApplyPreset} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="query">Query</Label>
            <Input
              id="query"
              placeholder="coffee shops in Austin, TX"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              disabled={isSearching}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Business type (optional, combine with several)</Label>
            <TypeCombobox value={types} onChange={setTypes} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rank">Rank by (optional)</Label>
            <Select
              value={rankPreference}
              onValueChange={(v) => setRankPreference(v as RankPreference)}
            >
              <SelectTrigger id="rank" className="w-full">
                <SelectValue placeholder="Relevance (default)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RELEVANCE">Relevance</SelectItem>
                <SelectItem value="DISTANCE">Distance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <p className="text-xs text-muted-foreground">
            Estimated cost: up to {formatUsd(worstCaseCostUsd)}
            {types.length > 1 ? ` (${types.length} types, one query each)` : ""} — usually far
            lower; this is the ceiling if every query pages the full 60 results.
          </p>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSearching || query.trim().length === 0}>
              {isSearching && <Loader2Icon className="animate-spin" />}
              Search
            </Button>
            <SaveSearchButton
              query={query}
              rankPreference={rankPreference === "" ? undefined : rankPreference}
            />
            <SavePresetButton types={types} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"quick" | "deep">(
    searchParams.get("tab") === "deep" ? "deep" : "quick",
  );

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "deep" || t === "quick") setTab(t);
  }, [searchParams]);

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-lg font-semibold">Search</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Quick Search runs a single query (up to 60 results). Deep Search
        adaptively tiles an area to find more than that, at the cost of more
        API calls.
      </p>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "quick" | "deep")}>
        <TabsList className="mb-4">
          <TabsTrigger value="quick">Quick Search</TabsTrigger>
          <TabsTrigger value="deep">Deep Search</TabsTrigger>
        </TabsList>
        <TabsContent value="quick">
          <QuickSearchForm />
        </TabsContent>
        <TabsContent value="deep">
          <DeepSearchForm />
        </TabsContent>
      </Tabs>

      <SavedSearchesPanel />
    </div>
  );
}
