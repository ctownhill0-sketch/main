import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2Icon, PlusIcon, RefreshCwIcon, SearchCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResultsTable } from "@/components/results/results-table";
import { estimateCostUsd, formatUsd } from "@/lib/cost";
import { commands, commandErrorMessage, type PlaceRow } from "@/lib/commands";

export function ResultsPage() {
  const [rows, setRows] = useState<PlaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);
  const [confirmDetailsOpen, setConfirmDetailsOpen] = useState(false);
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

  async function handleFetchDetails() {
    setConfirmDetailsOpen(false);
    setIsFetchingDetails(true);
    try {
      const { updated, failed } = await commands.fetchPlaceDetails([...selected]);
      if (updated.length > 0) {
        toast.success(`Fetched details for ${updated.length} lead${updated.length === 1 ? "" : "s"}.`);
      }
      if (failed.length > 0) {
        toast.error(`Failed for ${failed.length}: ${failed[0].error}`);
      }
      load();
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setIsFetchingDetails(false);
    }
  }

  const detailsCostUsd = estimateCostUsd("DetailsEnterprise", selected.size);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div>
          <h1 className="text-lg font-semibold">Results</h1>
          <p className="text-sm text-muted-foreground">
            Every place discovered so far. Place IDs are kept indefinitely; other
            fields are refreshed on rediscovery or when you fetch details.
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <>
              <Button size="sm" onClick={handleAddToPipeline} disabled={isAdding}>
                {isAdding ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
                Add {selected.size} to pipeline
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmDetailsOpen(true)}
                disabled={isFetchingDetails}
              >
                {isFetchingDetails ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <SearchCheckIcon className="size-4" />
                )}
                Fetch details ({selected.size})
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCwIcon className="size-4" />
            Refresh
          </Button>
        </div>
      </div>

      {rows === null && !error && (
        <div role="status" aria-label="Loading" className="flex flex-1 items-center justify-center">
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

      <Dialog open={confirmDetailsOpen} onOpenChange={setConfirmDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fetch full details?</DialogTitle>
            <DialogDescription>
              This calls Place Details at the Enterprise tier (phone, website, rating,
              hours) for exactly the {selected.size} selected place{selected.size === 1 ? "" : "s"} —
              never for every discovered place. This is the "Phase 2" spend the
              Compliance panel describes.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Estimated cost ({selected.size} x $0.020)</span>
            <Badge variant="warning">{formatUsd(detailsCostUsd)}</Badge>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDetailsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleFetchDetails}>Fetch details</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
