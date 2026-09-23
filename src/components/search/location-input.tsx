import { useEffect, useRef, useState } from "react";
import { ClockIcon, MapPinIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  commands,
  commandErrorMessage,
  type RecentLocationRow,
  type ResolvedLocation,
} from "@/lib/commands";

/**
 * Debounced single-shot location resolution — NOT live autocomplete. Google's
 * Geocoding API returns one best-match resolution per address string, not a
 * keystroke-by-keystroke prediction list; true autocomplete would need the
 * separate, unbudgeted Places Autocomplete API. Type, pause ~500ms, one
 * Geocoding call resolves the area and shows a confirmation chip. The
 * "Recent locations" dropdown re-selects instantly with no re-geocoding.
 */
export function LocationInput({
  id,
  value,
  onChange,
  onResolved,
  disabled,
  placeholder = "Austin, TX",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onResolved?: (resolved: ResolvedLocation | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [resolved, setResolved] = useState<ResolvedLocation | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<RecentLocationRow[] | null>(null);
  const debounced = useDebouncedValue(value, 500);
  const lastResolvedFor = useRef<string | null>(null);

  useEffect(() => {
    const trimmed = debounced.trim();
    if (!trimmed) {
      setResolved(null);
      setError(null);
      onResolved?.(null);
      return;
    }
    if (trimmed === lastResolvedFor.current) return;

    setResolving(true);
    setError(null);
    commands
      .resolveLocation(trimmed)
      .then((r) => {
        lastResolvedFor.current = trimmed;
        setResolved(r);
        onResolved?.(r);
      })
      .catch((err) => {
        setResolved(null);
        onResolved?.(null);
        setError(commandErrorMessage(err));
      })
      .finally(() => setResolving(false));
    // Only re-run when the debounced text itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function openRecent(open: boolean) {
    setRecentOpen(open);
    if (open && recent === null) {
      commands.listRecentLocations().then(setRecent).catch(() => setRecent([]));
    }
  }

  function applyRecent(row: RecentLocationRow) {
    lastResolvedFor.current = row.formattedAddress;
    onChange(row.formattedAddress);
    const asResolved: ResolvedLocation = {
      formattedAddress: row.formattedAddress,
      viewport: {
        low: { latitude: row.lowLat, longitude: row.lowLng },
        high: { latitude: row.highLat, longitude: row.highLng },
      },
      // Skipping a re-geocode call is the point of "recent" — width/height
      // aren't stored, so the confirmation chip just omits them here.
      approxWidthKm: 0,
      approxHeightKm: 0,
    };
    setResolved(asResolved);
    onResolved?.(asResolved);
    setRecentOpen(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Input
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          disabled={disabled}
          required
          className="flex-1"
        />
        <Popover open={recentOpen} onOpenChange={openRecent}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Recent locations"
              disabled={disabled}
            >
              <ClockIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="end">
            <Command>
              <CommandList>
                <CommandEmpty>
                  {recent === null ? "Loading..." : "No recent locations yet."}
                </CommandEmpty>
                <CommandGroup heading="Recent locations">
                  {(recent ?? []).map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.formattedAddress}
                      onSelect={() => applyRecent(r)}
                    >
                      {r.formattedAddress}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {resolving && <p className="text-xs text-muted-foreground">Resolving…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {resolved && !resolving && !error && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPinIcon className="size-3 shrink-0" />
          <span className="truncate">{resolved.formattedAddress}</span>
          {resolved.approxWidthKm > 0 && (
            <span className="shrink-0">
              · ~{resolved.approxWidthKm.toFixed(0)}km × {resolved.approxHeightKm.toFixed(0)}km
            </span>
          )}
        </p>
      )}
    </div>
  );
}
