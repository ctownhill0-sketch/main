import { useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon, StarIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { PlaceRow } from "@/lib/commands";

type SortKey = "displayName" | "formattedAddress" | "primaryType" | "businessStatus" | "rating";
type SortDir = "asc" | "desc";
type WebsiteFilter = "all" | "no-website" | "has-website" | "not-checked";

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
      className="flex items-center gap-1 hover:text-foreground"
    >
      {label}
      <Icon className="size-3" />
    </button>
  );
}

export function ResultsTable({
  rows,
  selected,
  onSelectedChange,
}: {
  rows: PlaceRow[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [websiteFilter, setWebsiteFilter] = useState<WebsiteFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("displayName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
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

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={(c) => toggleAll(c === true)}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>
                <SortHeader label="Name" sortKey="displayName" active={sortKey === "displayName"} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead>
                <SortHeader label="Address" sortKey="formattedAddress" active={sortKey === "formattedAddress"} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead>
                <SortHeader label="Type" sortKey="primaryType" active={sortKey === "primaryType"} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead>
                <SortHeader label="Status" sortKey="businessStatus" active={sortKey === "businessStatus"} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>
                <SortHeader label="Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={toggleSort} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => {
              const isSelected = selected.has(row.placeId);
              const noWebsite = row.lastDetailsRefreshedAt && !row.websiteUri;
              return (
                <TableRow
                  key={row.placeId}
                  data-state={isSelected ? "selected" : undefined}
                  className={cn(noWebsite && "bg-warning/5")}
                >
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(c) => toggleRow(row.placeId, c === true)}
                      aria-label={`Select ${row.displayName ?? row.placeId}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{row.displayName ?? "Unnamed"}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {row.formattedAddress ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.primaryType ?? "—"}</TableCell>
                  <TableCell>
                    {row.businessStatus ? (
                      <Badge variant={statusBadgeVariant(row.businessStatus)}>
                        {row.businessStatus.replaceAll("_", " ")}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.nationalPhoneNumber ?? "—"}
                  </TableCell>
                  <TableCell>
                    <WebsiteBadge row={row} />
                  </TableCell>
                  <TableCell>
                    {row.rating != null ? (
                      <span className="flex items-center gap-1">
                        <StarIcon className="size-3 fill-current text-warning" />
                        {row.rating.toFixed(1)}
                        <span className="text-muted-foreground">({row.userRatingCount ?? 0})</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No places match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
