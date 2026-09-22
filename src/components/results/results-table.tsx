import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon, StarIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { GoogleAttribution } from "@/components/common/google-attribution";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PlaceRow } from "@/lib/commands";

type SortKey = "displayName" | "formattedAddress" | "primaryType" | "businessStatus" | "rating";
type SortDir = "asc" | "desc";
type WebsiteFilter = "all" | "no-website" | "has-website" | "not-checked";

// Shared between the sticky header and every virtual row so columns never
// drift out of alignment.
const GRID_TEMPLATE =
  "2.5rem minmax(160px,1.4fr) minmax(180px,1.6fr) minmax(90px,0.8fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(110px,0.8fr) minmax(90px,0.8fr)";
const ROW_HEIGHT = 44;

function statusBadgeVariant(status: string | null) {
  if (status === "OPERATIONAL") return "success" as const;
  if (status === "CLOSED_PERMANENTLY" || status === "CLOSED_TEMPORARILY") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

function WebsiteBadge({ row }: { row: PlaceRow }) {
  if (!row.lastDetailsRefreshedAt) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Not checked
      </Badge>
    );
  }
  if (!row.websiteUri) {
    return <Badge variant="warning">No website</Badge>;
  }
  return (
    <a
      href={row.websiteUri}
      target="_blank"
      rel="noreferrer"
      className="text-sm text-primary underline underline-offset-2"
      onClick={(e) => e.stopPropagation()}
    >
      Visit site
    </a>
  );
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}) {
  const Icon = active ? (dir === "asc" ? ArrowUpIcon : ArrowDownIcon) : ArrowUpDownIcon;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className="flex cursor-default items-center gap-1 hover:text-foreground"
    >
      {label}
      <Icon className="size-3" />
    </button>
  );
}

/** One grid "row" of cells — used by both real rows and the header row so
 * column boundaries always line up via GRID_TEMPLATE. */
function GridRow({
  children,
  className,
  role = "row",
  style,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  role?: string;
  style?: CSSProperties;
  "data-state"?: string;
}) {
  return (
    <div
      role={role}
      className={cn("grid items-center", className)}
      style={{ gridTemplateColumns: GRID_TEMPLATE, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Cell({
  children,
  className,
  role = "cell",
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  role?: string;
  title?: string;
}) {
  return (
    <div role={role} className={cn("truncate px-3", className)} title={title}>
      {children}
    </div>
  );
}

export function ResultsTable({
  rows,
  selected,
  onSelectedChange,
  newPlaceIds,
}: {
  rows: PlaceRow[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  newPlaceIds?: Set<string>;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [websiteFilter, setWebsiteFilter] = useState<WebsiteFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("displayName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const scrollRef = useRef<HTMLDivElement>(null);

  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.businessStatus).filter(Boolean))) as string[],
    [rows],
  );
  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => r.primaryType).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const haystack = `${r.displayName ?? ""} ${r.formattedAddress ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (statusFilter !== "all" && r.businessStatus !== statusFilter) return false;
      if (typeFilter !== "all" && r.primaryType !== typeFilter) return false;
      if (websiteFilter === "no-website" && !(r.lastDetailsRefreshedAt && !r.websiteUri)) {
        return false;
      }
      if (websiteFilter === "has-website" && !r.websiteUri) return false;
      if (websiteFilter === "not-checked" && r.lastDetailsRefreshedAt) return false;
      return true;
    });
  }, [rows, search, statusFilter, typeFilter, websiteFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleRow(placeId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(placeId);
    else next.delete(placeId);
    onSelectedChange(next);
  }

  const allFilteredSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.placeId));

  function toggleAll(checked: boolean) {
    const next = new Set(selected);
    for (const r of sorted) {
      if (checked) next.add(r.placeId);
      else next.delete(r.placeId);
    }
    onSelectedChange(next);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
        <Input
          placeholder="Filter by name or address..."
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
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
        <Select value={typeFilter} onValueChange={setTypeFilter}>
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
        <Select value={websiteFilter} onValueChange={(v) => setWebsiteFilter(v as WebsiteFilter)}>
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
        <span className="ml-auto text-xs text-muted-foreground">
          {sorted.length} of {rows.length} places
          {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </span>
      </div>

      <div ref={scrollRef} role="table" aria-label="Results" className="flex-1 overflow-auto">
        <GridRow
          role="row"
          className="sticky top-0 z-10 h-9 border-b border-border/60 bg-background text-xs text-muted-foreground"
        >
          <Cell role="columnheader" className="flex items-center overflow-visible">
            <Checkbox
              checked={allFilteredSelected}
              onCheckedChange={(c) => toggleAll(c === true)}
              aria-label="Select all"
            />
          </Cell>
          <Cell role="columnheader" className="overflow-visible">
            <SortHeader label="Name" sortKey="displayName" active={sortKey === "displayName"} dir={sortDir} onClick={toggleSort} />
          </Cell>
          <Cell role="columnheader" className="overflow-visible">
            <SortHeader label="Address" sortKey="formattedAddress" active={sortKey === "formattedAddress"} dir={sortDir} onClick={toggleSort} />
          </Cell>
          <Cell role="columnheader" className="overflow-visible">
            <SortHeader label="Type" sortKey="primaryType" active={sortKey === "primaryType"} dir={sortDir} onClick={toggleSort} />
          </Cell>
          <Cell role="columnheader" className="overflow-visible">
            <SortHeader label="Status" sortKey="businessStatus" active={sortKey === "businessStatus"} dir={sortDir} onClick={toggleSort} />
          </Cell>
          <Cell role="columnheader">Phone</Cell>
          <Cell role="columnheader">Website</Cell>
          <Cell role="columnheader" className="overflow-visible">
            <SortHeader label="Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={toggleSort} />
          </Cell>
        </GridRow>

        {sorted.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No places match the current filters.
          </div>
        ) : (
          <div
            role="rowgroup"
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = sorted[virtualRow.index];
              const isSelected = selected.has(row.placeId);
              const noWebsite = row.lastDetailsRefreshedAt && !row.websiteUri;
              const isNew = newPlaceIds?.has(row.placeId) ?? false;
              return (
                <GridRow
                  key={row.placeId}
                  data-state={isSelected ? "selected" : undefined}
                  className={cn(
                    "absolute top-0 left-0 w-full border-b border-border/60 transition-colors duration-150 hover:bg-muted/50 data-[state=selected]:bg-muted",
                    noWebsite && "bg-warning/5",
                    isNew && "border-l-2 border-l-primary",
                  )}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <Cell className="overflow-visible">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(c) => toggleRow(row.placeId, c === true)}
                      aria-label={`Select ${row.displayName ?? row.placeId}`}
                    />
                  </Cell>
                  <Cell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{row.displayName ?? "Unnamed"}</span>
                      {isNew && (
                        <Badge variant="default" className="shrink-0 text-[10px]">
                          New
                        </Badge>
                      )}
                    </span>
                  </Cell>
                  <Cell className="text-muted-foreground" title={row.formattedAddress ?? undefined}>
                    {row.formattedAddress ?? "—"}
                  </Cell>
                  <Cell className="text-muted-foreground">{row.primaryType ?? "—"}</Cell>
                  <Cell className="overflow-visible">
                    {row.businessStatus ? (
                      <Badge variant={statusBadgeVariant(row.businessStatus)}>
                        {row.businessStatus.replaceAll("_", " ")}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </Cell>
                  <Cell className="text-muted-foreground">{row.nationalPhoneNumber ?? "—"}</Cell>
                  <Cell className="overflow-visible">
                    <WebsiteBadge row={row} />
                  </Cell>
                  <Cell className="overflow-visible">
                    {row.rating != null ? (
                      <span className="flex items-center gap-1">
                        <StarIcon className="size-3 shrink-0 fill-current text-warning" />
                        {row.rating.toFixed(1)}
                        <span className="text-muted-foreground">({row.userRatingCount ?? 0})</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </Cell>
                </GridRow>
              );
            })}
          </div>
        )}
      </div>
      <GoogleAttribution />
    </div>
  );
}
