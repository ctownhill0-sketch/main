import { useState } from "react";
import { ChevronsUpDownIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ALL_PLACE_TYPES, placeTypesByGroup } from "@/lib/place-types";
import { cn } from "@/lib/utils";

export function TypeCombobox({
  value,
  onChange,
  multiple = true,
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  /** Deep Search stays single-type (see places/client.rs's doc comment on
   * why `includedType` is singular) — pass `multiple={false}` there. */
  multiple?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const grouped = placeTypesByGroup();
  const selectedLabels = value.map(
    (v) => ALL_PLACE_TYPES.find((t) => t.value === v)?.label ?? v,
  );

  function toggle(typeValue: string) {
    if (!multiple) {
      onChange(value.includes(typeValue) ? [] : [typeValue]);
      setOpen(false);
      return;
    }
    onChange(
      value.includes(typeValue)
        ? value.filter((v) => v !== typeValue)
        : [...value, typeValue],
    );
  }

  function remove(typeValue: string) {
    onChange(value.filter((v) => v !== typeValue));
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            {value.length === 0 ? (
              <span className="text-muted-foreground">Any business type</span>
            ) : (
              <span>
                {value.length} type{value.length === 1 ? "" : "s"} selected
              </span>
            )}
            <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search business types..." />
            <CommandList>
              <CommandEmpty>No matching type.</CommandEmpty>
              {[...grouped.entries()].map(([group, types]) => (
                <CommandGroup key={group} heading={group}>
                  {types.map((t) => (
                    <Tooltip key={t.value}>
                      <TooltipTrigger asChild>
                        <CommandItem value={t.label} onSelect={() => toggle(t.value)}>
                          <span
                            className={cn(
                              "flex size-4 items-center justify-center rounded-sm border border-border/60",
                              value.includes(t.value) && "border-primary bg-primary text-primary-foreground",
                            )}
                          >
                            {value.includes(t.value) && (
                              <svg viewBox="0 0 12 12" className="size-3" fill="none">
                                <path
                                  d="M2.5 6.5L4.75 8.75L9.5 3.5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </span>
                          {t.label}
                        </CommandItem>
                      </TooltipTrigger>
                      <TooltipContent side="right">{t.value}</TooltipContent>
                    </Tooltip>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((typeValue, i) => (
            <Badge key={typeValue} variant="secondary" className="gap-1 pr-1">
              {selectedLabels[i]}
              <button
                type="button"
                onClick={() => remove(typeValue)}
                aria-label={`Remove ${selectedLabels[i]}`}
                className="rounded-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
