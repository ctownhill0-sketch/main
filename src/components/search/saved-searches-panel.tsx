import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2Icon, PlayIcon, SaveIcon, SparklesIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commands, commandErrorMessage, type RankPreference, type SavedSearchRow } from "@/lib/commands";

export function SaveSearchButton({
  query,
  rankPreference,
}: {
  query: string;
  rankPreference?: RankPreference;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await commands.saveSearch(name.trim() || query, query, rankPreference);
      toast.success("Search saved.");
      setOpen(false);
      setName("");
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={query.trim().length === 0}>
          <SaveIcon className="size-4" />
          Save search
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this search</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="saved-search-name">Name</Label>
          <Input
            id="saved-search-name"
            placeholder={query}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SavedSearchesPanel() {
  const navigate = useNavigate();
  const [searches, setSearches] = useState<SavedSearchRow[] | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);

  function load() {
    commands.listSavedSearches().then(setSearches).catch(() => setSearches([]));
  }

  useEffect(load, []);

  async function handleRun(search: SavedSearchRow) {
    setRunningId(search.id);
    try {
      const { results, newPlaceIds } = await commands.runSavedSearch(search.id);
      toast.success(
        newPlaceIds.length > 0
          ? `${results.length} results, ${newPlaceIds.length} new since last run.`
          : `${results.length} results — no new places since last run.`,
      );
      load();
      navigate(`/results?new=${encodeURIComponent(newPlaceIds.join(","))}`);
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setRunningId(null);
    }
  }

  async function handleDelete(id: number) {
    await commands.deleteSavedSearch(id);
    load();
  }

  if (!searches || searches.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-sm">Saved searches</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {searches.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{s.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {s.params.query}
                {s.lastRunAt ? ` · last run ${new Date(s.lastRunAt).toLocaleString()}` : " · never run"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!s.lastRunAt && (
                <Badge variant="outline" className="gap-1">
                  <SparklesIcon className="size-3" />
                  New
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRun(s)}
                disabled={runningId === s.id}
              >
                {runningId === s.id ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
                Run
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(s.id)}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
