import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2Icon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResultsTable } from "@/components/results/results-table";
import { commands, commandErrorMessage, type PlaceRow } from "@/lib/commands";

export function ResultsPage() {
  const [rows, setRows] = useState<PlaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [searchParams] = useSearchParams();
  const newPlaceIds = useMemo(() => {
    const raw = searchParams.get("new");
    return new Set(raw ? raw.split(",").filter(Boolean) : []);
  }, [searchParams]);

  function load() {
    setError(null);
    commands
      .listPlaces()
      .then(setRows)
      .catch((err) => setError(commandErrorMessage(err)));
  }

  useEffect(load, []);

  async function handleAddToPipeline() {
    setIsAdding(true);
    try {
      await Promise.all([...selected].map((placeId) => commands.addLead(placeId)));
      toast.success(`Added ${selected.size} lead${selected.size === 1 ? "" : "s"} to the pipeline.`);
      setSelected(new Set());
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h1 className="text-lg font-semibold">Results</h1>
          <p className="text-sm text-muted-foreground">
            Every place discovered so far. Place IDs are kept indefinitely; other
            fields are refreshed on rediscovery or when you fetch details.
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button size="sm" onClick={handleAddToPipeline} disabled={isAdding}>
              {isAdding ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              Add {selected.size} to pipeline
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCwIcon className="size-4" />
            Refresh
          </Button>
        </div>
      </div>

      {rows === null && !error && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="p-6 text-sm text-destructive">{error}</div>
      )}

      {rows !== null && rows.length === 0 && !error && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No results yet — run a search first.
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ResultsTable
          rows={rows}
          selected={selected}
          onSelectedChange={setSelected}
          newPlaceIds={newPlaceIds}
        />
      )}
    </div>
  );
}
