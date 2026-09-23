import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  InfoIcon,
  KanbanIcon,
  PlusIcon,
  SearchCheckIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TableIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const ROUTES = [
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/results", label: "Results", icon: TableIcon },
  { to: "/pipeline", label: "Pipeline", icon: KanbanIcon },
  { to: "/compliance", label: "Compliance", icon: ShieldCheckIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/about", label: "About", icon: InfoIcon },
] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages or actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {ROUTES.map(({ to, label, icon: Icon }) => (
            <CommandItem key={to} value={label} onSelect={() => go(to)}>
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="New Quick Search" onSelect={() => go("/search?tab=quick")}>
            <PlusIcon />
            New Quick Search
          </CommandItem>
          <CommandItem value="New Deep Search" onSelect={() => go("/search?tab=deep")}>
            <SearchCheckIcon />
            New Deep Search
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
