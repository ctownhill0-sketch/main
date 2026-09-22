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

const NAV_ITEMS = [
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/results", label: "Results", icon: TableIcon },
  { to: "/pipeline", label: "Pipeline", icon: KanbanIcon },
  { to: "/compliance", label: "Compliance", icon: ShieldCheckIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center gap-2 px-4 py-4">
          <MapPinIcon className="size-5 text-primary" />
          <span className="text-sm font-semibold tracking-tight">LeadScout</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
