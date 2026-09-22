import { useEffect, useState } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ResultsTable } from "@/components/results/results-table";
import { commands, commandErrorMessage, type PlaceRow } from "@/lib/commands";

export function ResultsPage() {
  const [rows, setRows] = useState<PlaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function load() {
    setError(null);
    commands
      .listPlaces()
      .then(setRows)
      .catch((err) => setError(commandErrorMessage(err)));
  }

  useEffect(load, []);

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
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCwIcon className="size-4" />
          Refresh
        </Button>
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
        <ResultsTable rows={rows} selected={selected} onSelectedChange={setSelected} />
      )}
    </div>
  );
}
