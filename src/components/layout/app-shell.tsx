import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  SearchIcon,
  TableIcon,
  KanbanIcon,
  ShieldCheckIcon,
  SettingsIcon,
  MapPinIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { isMacOS } from "@/lib/platform";

const NAV_ITEMS = [
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/results", label: "Results", icon: TableIcon },
  { to: "/pipeline", label: "Pipeline", icon: KanbanIcon },
  { to: "/compliance", label: "Compliance", icon: ShieldCheckIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const macOS = isMacOS();

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border/60 bg-muted/30">
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-11 shrink-0 select-none items-center gap-2 px-4",
            // Reserve room for the inset traffic lights (titleBarStyle:
            // Overlay) on macOS only — other platforms keep native chrome.
            macOS && "pl-20",
          )}
        >
          <MapPinIcon className="pointer-events-none size-5 text-primary" />
          <span className="pointer-events-none text-sm font-semibold tracking-tight">
            LeadScout
          </span>
        </div>
        <nav className="flex select-none flex-col gap-0.5 px-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto select-none px-4 py-3 text-xs text-muted-foreground">
          <kbd className="rounded border border-border/60 bg-background px-1.5 py-0.5 font-sans">
            {macOS ? "⌘K" : "Ctrl+K"}
          </kbd>{" "}
          to search
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
