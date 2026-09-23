import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Loader2Icon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocationInput } from "@/components/search/location-input";
import { PresetsDropdown } from "@/components/search/presets-dropdown";
import { RadiusSlider } from "@/components/search/radius-slider";
import { TypeCombobox } from "@/components/search/type-combobox";
import { estimateCostUsd, formatUsd } from "@/lib/cost";
import { commands, commandErrorMessage, type DeepSearchProgressEvent, type Preset } from "@/lib/commands";

const DEPTH_OPTIONS = [
  { value: "4", label: "Shallow (max depth 4)" },
  { value: "6", label: "Medium (max depth 6, default)" },
  { value: "8", label: "Deep (max depth 8)" },
];

const DEFAULT_CALL_CAP = 200;

type RunState = "idle" | "confirming" | "running" | "done";

export function DeepSearchForm() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(8000);
  const [maxDepth, setMaxDepth] = useState("6");
  const [callCap, setCallCap] = useState(String(DEFAULT_CALL_CAP));
  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DeepSearchProgressEvent | null>(null);

  const runIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const callCapNum = Number(callCap) || DEFAULT_CALL_CAP;
  const worstCaseCostUsd = estimateCostUsd("SearchPro", callCapNum);

  function handleApplyPreset(preset: Preset) {
    // Deep Search stays single-type — take the preset's first type, if any.
    setTypes(preset.types.length > 0 ? [preset.types[0]] : []);
    if (preset.suggestedRadiusMeters) {
      setRadiusMeters(preset.suggestedRadiusMeters);
    }
  }

  function handleOpenConfirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setState("confirming");
  }

  async function handleConfirm() {
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    setState("running");
    setProgress(null);

    unlistenRef.current = await listen<DeepSearchProgressEvent>(
      "deep-search-progress",
      (event) => {
        if (event.payload.runId === runId) {
          setProgress(event.payload);
        }
      },
    );

    try {
      const summary = await commands.startDeepSearch({
        runId,
        query,
        location,
        maxDepth: Number(maxDepth),
        callCap: callCapNum,
        placeType: types[0],
      });
      setState("done");
      const label = summary.cancelled
        ? "Deep Search cancelled"
        : summary.callCapReached
          ? "Deep Search stopped (call cap reached)"
          : "Deep Search complete";
      toast.success(
        `${label}: ${summary.placeIds.length} unique places found in ${summary.areaFormattedAddress} (${summary.tilesScanned} tiles, ${formatUsd(summary.estimatedCostUsd)}).`,
      );
      navigate("/results");
    } catch (err) {
      setState("idle");
      setError(commandErrorMessage(err));
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  }

  async function handleCancel() {
    if (runIdRef.current) {
      await commands.cancelDeepSearch(runIdRef.current).catch(() => {});
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Deep Search (adaptive quadtree)</CardTitle>
          <CardDescription>
            Beats Google's 60-result cap by recursively splitting the area into
            smaller tiles wherever a tile hits the cap. Runs a Text Search per
            tile (MASK_DISCOVERY, Pro tier) and is stoppable at any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleOpenConfirm} className="flex flex-col gap-4">
            <PresetsDropdown onApply={handleApplyPreset} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deep-query">Business type / keyword</Label>
              <Input
                id="deep-query"
                placeholder="coffee shops"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                disabled={state === "running"}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Structured type (optional)</Label>
              <TypeCombobox value={types} onChange={setTypes} multiple={false} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deep-location">Location / area</Label>
              <LocationInput
                id="deep-location"
                placeholder="Austin, TX"
                value={location}
                onChange={setLocation}
                disabled={state === "running"}
              />
            </div>
            <RadiusSlider meters={radiusMeters} onChange={setRadiusMeters} disabled={state === "running"} />
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deep-depth">Coverage depth</Label>
                <Select value={maxDepth} onValueChange={setMaxDepth} disabled={state === "running"}>
                  <SelectTrigger id="deep-depth" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPTH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deep-cap">Per-run call cap</Label>
                <Input
                  id="deep-cap"
                  type="number"
                  min={1}
                  value={callCap}
                  onChange={(e) => setCallCap(e.currentTarget.value)}
                  disabled={state === "running"}
                />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {state !== "running" && (
              <Button
                type="submit"
                disabled={query.trim().length === 0 || location.trim().length === 0}
              >
                Review cost & start
              </Button>
            )}
          </form>

          {state === "running" && (
            <div className="mt-4 flex flex-col gap-3 rounded-md border border-border/60 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Loader2Icon className="size-4 animate-spin" />
                  Searching…
                </span>
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  <XIcon className="size-4" />
                  Cancel
                </Button>
              </div>
              <Progress
                value={
                  progress ? Math.min(100, (progress.callsMade / callCapNum) * 100) : 0
                }
              />
              <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground sm:grid-cols-4">
                <div>
                  Tiles scanned
                  <div className="text-foreground">{progress?.tilesScanned ?? 0}</div>
                </div>
                <div>
                  Tiles subdivided
                  <div className="text-foreground">{progress?.tilesSubdivided ?? 0}</div>
                </div>
                <div>
                  Unique places
                  <div className="text-foreground">{progress?.uniquePlacesFound ?? 0}</div>
                </div>
                <div>
                  Est. cost
                  <div className="text-foreground">
                    {formatUsd(progress?.estimatedCostUsd ?? 0)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={state === "confirming"} onOpenChange={(open) => !open && setState("idle")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deep Search cost</DialogTitle>
            <DialogDescription>
              This run is hard-capped at your per-run call cap — it stops automatically
              if it reaches that many Search API calls, even if more tiles are queued.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Area</span>
              <span>{location || "—"}</span>
            </div>
            {types[0] && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Structured type</span>
                <span>{types[0]}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Coverage depth</span>
              <span>{DEPTH_OPTIONS.find((o) => o.value === maxDepth)?.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Per-run call cap</span>
              <span>{callCapNum} calls</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Worst-case cost (Text Search Pro, $32/1k)</span>
              <span>
                <Badge variant="warning">{formatUsd(worstCaseCostUsd)}</Badge>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Actual cost is usually far lower — this is the ceiling if the run used
              every call in the cap. It will also stop early once a tile returns fewer
              than 60 results (nothing left to subdivide) or you cancel it. This
              estimate does not account for remaining free-tier monthly calls; check
              the Compliance panel for your current spend.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setState("idle")}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Start Deep Search</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
