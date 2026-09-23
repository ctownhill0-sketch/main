import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

const MIN_METERS = 1000;
const MAX_METERS = 50000;
const STEP_METERS = 1000;
const KM_PER_MILE = 1.60934;

/**
 * Cost-estimate/warning input only in this pass — Deep Search already tiles
 * the whole geocoded viewport via Text Search, not a circle from a center
 * point, so this doesn't yet constrain what Google is asked for. See
 * DESIGN.md/commit notes for why: enforcing it would mean adopting Nearby
 * Search's circle-based `locationRestriction` app-wide, a bigger fork than
 * "add a slider."
 */
export function RadiusSlider({
  meters,
  onChange,
  disabled,
}: {
  meters: number;
  onChange: (meters: number) => void;
  disabled?: boolean;
}) {
  const [unit, setUnit] = useState<"km" | "mi">("km");
  const km = meters / 1000;
  const mi = km / KM_PER_MILE;
  const areaKm2 = Math.PI * km * km;
  const areaMi2 = Math.PI * mi * mi;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>Radius (estimate only)</Label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {unit === "km" ? `${km.toFixed(1)} km` : `${mi.toFixed(1)} mi`} · ~
            {unit === "km" ? `${areaKm2.toFixed(0)} km²` : `${areaMi2.toFixed(0)} mi²`}
          </span>
          <button
            type="button"
            onClick={() => setUnit((u) => (u === "km" ? "mi" : "km"))}
            className="underline decoration-dotted underline-offset-2 transition-colors duration-150 hover:text-foreground"
          >
            switch to {unit === "km" ? "mi" : "km"}
          </button>
        </div>
      </div>
      <Slider
        value={[meters]}
        onValueChange={([v]) => onChange(v)}
        min={MIN_METERS}
        max={MAX_METERS}
        step={STEP_METERS}
        disabled={disabled}
      />
    </div>
  );
}
