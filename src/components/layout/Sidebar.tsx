"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOrganization, useUser } from "@clerk/nextjs";
import {
  LayoutDashboard,
  Search,
  Settings,
  Video,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/meetings", label: "Meetings", icon: Video },
  { href: "/search", label: "Search", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/**
 * Fixed left sidebar (240px desktop, icon-only 64px on mobile).
 * Brand-800 navy background per the design system — no top nav.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const { organization } = useOrganization();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-16 flex-col border-r border-white/5 bg-brand-800 md:w-60">
      {/* Logo + org */}
      <div className="flex items-center gap-3 px-3 py-5 md:px-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-accent text-sm font-bold text-white">
          In
        </div>
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            Insider
          </p>
          <p className="truncate text-xs text-zinc-400">
            {organization?.name ?? "Personal workspace"}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="mt-2 flex-1 space-y-0.5 px-2 md:px-3">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100",
                active &&
                  "border-brand-accent bg-brand-accent/10 text-white hover:bg-brand-accent/10",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden md:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Current user */}
      <div className="border-t border-white/5 px-3 py-4 md:px-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={user?.imageUrl} alt={user?.fullName ?? "User"} />
            <AvatarFallback className="bg-brand-700 text-xs text-zinc-200">
              {(user?.firstName?.[0] ?? "U").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm font-medium text-zinc-100">
              {user?.fullName ?? "—"}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {user?.primaryEmailAddress?.emailAddress ?? ""}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
