import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { isOpenNow } from "@/lib/opening-hours";
import type { PlaceRow } from "@/lib/commands";

export type WebsiteFilter = "all" | "no-website" | "has-website" | "not-checked";
export type PhoneFilter = "all" | "has-phone" | "no-phone";

export interface RefineFilters {
  search: string;
  status: string;
  type: string;
  website: WebsiteFilter;
  phone: PhoneFilter;
  /** 0 means no minimum. */
  minRating: number;
  /** null means no maximum. */
  maxReviewCount: number | null;
  openNowOnly: boolean;
}

export const DEFAULT_REFINE_FILTERS: RefineFilters = {
  search: "",
  status: "all",
  type: "all",
  website: "all",
  phone: "all",
  minRating: 0,
  maxReviewCount: null,
  openNowOnly: false,
};

/** Client-side only — narrows already-fetched rows, never re-spends an API call. */
export function matchesRefineFilters(row: PlaceRow, f: RefineFilters): boolean {
  if (f.search) {
    const haystack = `${row.displayName ?? ""} ${row.formattedAddress ?? ""}`.toLowerCase();
    if (!haystack.includes(f.search.trim().toLowerCase())) return false;
  }
  if (f.status !== "all" && row.businessStatus !== f.status) return false;
  if (f.type !== "all" && row.primaryType !== f.type) return false;
  if (f.website === "no-website" && !(row.lastDetailsRefreshedAt && !row.websiteUri)) return false;
  if (f.website === "has-website" && !row.websiteUri) return false;
  if (f.website === "not-checked" && row.lastDetailsRefreshedAt) return false;
  if (f.phone === "has-phone" && !row.nationalPhoneNumber) return false;
  if (f.phone === "no-phone" && row.nationalPhoneNumber) return false;
  if (f.minRating > 0 && (row.rating == null || row.rating < f.minRating)) return false;
  if (f.maxReviewCount != null && (row.userRatingCount == null || row.userRatingCount > f.maxReviewCount)) {
    return false;
  }
  if (f.openNowOnly && isOpenNow(row.regularOpeningHoursJson) !== true) return false;
  return true;
}

export function RefineBar({
  rows,
  filters,
  onFiltersChange,
}: {
  rows: PlaceRow[];
  filters: RefineFilters;
  onFiltersChange: (next: RefineFilters) => void;
}) {
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.businessStatus).filter(Boolean))) as string[],
    [rows],
  );
  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => r.primaryType).filter(Boolean))) as string[],
    [rows],
  );
  const filteredCount = useMemo(
    () => rows.filter((r) => matchesRefineFilters(r, filters)).length,
    [rows, filters],
  );

  function set<K extends keyof RefineFilters>(key: K, value: RefineFilters[K]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
      <Input
        placeholder="Filter by name or address..."
        value={filters.search}
        onChange={(e) => set("search", e.currentTarget.value)}
        className="max-w-xs"
      />
      <Select value={filters.status} onValueChange={(v) => set("status", v)}>
        <SelectTrigger size="sm" className="w-40">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.type} onValueChange={(v) => set("type", v)}>
        <SelectTrigger size="sm" className="w-40">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {types.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.website} onValueChange={(v) => set("website", v as WebsiteFilter)}>
        <SelectTrigger size="sm" className="w-44">
          <SelectValue placeholder="Website" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any website status</SelectItem>
          <SelectItem value="no-website">No website (checked)</SelectItem>
          <SelectItem value="has-website">Has website</SelectItem>
          <SelectItem value="not-checked">Not checked yet</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.phone} onValueChange={(v) => set("phone", v as PhoneFilter)}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="Phone" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any phone status</SelectItem>
          <SelectItem value="has-phone">Has phone</SelectItem>
          <SelectItem value="no-phone">No phone</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Min rating</Label>
        <div className="w-24">
          <Slider
            value={[filters.minRating]}
            min={0}
            max={5}
            step={0.5}
            onValueChange={([v]) => set("minRating", v)}
          />
        </div>
        <span className="w-7 text-xs text-muted-foreground">
          {filters.minRating > 0 ? filters.minRating.toFixed(1) : "Any"}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Label htmlFor="max-review-count" className="text-xs text-muted-foreground">
          Max reviews
        </Label>
        <Input
          id="max-review-count"
          type="number"
          min={0}
          placeholder="Any"
          value={filters.maxReviewCount ?? ""}
          onChange={(e) => {
            const v = e.currentTarget.value;
            set("maxReviewCount", v === "" ? null : Number(v));
          }}
          className="h-8 w-20"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <Switch
          id="open-now"
          checked={filters.openNowOnly}
          onCheckedChange={(c) => set("openNowOnly", c)}
        />
        <Label htmlFor="open-now" className="text-xs text-muted-foreground">
          Open now
        </Label>
      </div>

      <span className="ml-auto text-xs text-muted-foreground">
        {filteredCount} of {rows.length} places
      </span>
    </div>
  );
}
