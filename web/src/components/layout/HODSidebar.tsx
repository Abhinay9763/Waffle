"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, UserCheck, Activity, FileText, CalendarDays, BarChart2, MessageSquareWarning, LogOut, Loader2 } from "lucide-react";
import { WaffleLogo } from "@/components/WaffleLogo";
import { getCookie, deleteCookie } from "cookies-next";
import { API, APP_NAME } from "@/lib/config";

const NAV = [
  { label: "Dashboard",        href: "/hod",       icon: LayoutDashboard },
  { label: "Faculty Approvals", href: "/approvals", icon: Users },
  { label: "Faculty Management", href: "/hod/faculty", icon: UserCheck },
  { label: "System Oversight", href: "/hod/oversight", icon: Activity },
  { label: "Question Papers",  href: "/hod/papers",    icon: FileText },
  { label: "Exams",            href: "/hod/exams",     icon: CalendarDays },
  { label: "Results",          href: "/hod/responses", icon: BarChart2 },
  { label: "Solved Queries",   href: "/hod/queries",   icon: MessageSquareWarning },
];

export default function HODSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; roll: string } | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);

  useEffect(() => {
    const validateSession = async () => {
      const token = getCookie("wfl-session") as string | undefined;
      const raw = getCookie("wfl-user") as string | undefined;

      // No token = redirect to login immediately
      if (!token) {
        router.replace("/login");
        return;
      }

      try {
        const response = await fetch(`${API}/user/session`, {
          headers: { "x-session-token": token }
        });

        if (!response.ok) {
          // Session invalid (could be expired, pending approval, etc.)
          deleteCookie("wfl-session");
          deleteCookie("wfl-user");
          router.replace("/login?expired=1");
          return;
        }

        const sessionData = await response.json();

        // Verify this is actually an HOD user
        if (sessionData.user?.role !== "HOD") {
          deleteCookie("wfl-session");
          deleteCookie("wfl-user");
          router.replace("/login");
          return;
        }

        // Auth successful - set user and stop loading
        setUser(raw ? JSON.parse(raw) : sessionData.user);
        setIsAuthenticating(false);

      } catch {
        // Network error or other issue
        deleteCookie("wfl-session");
        deleteCookie("wfl-user");
        router.replace("/login");
      }
    };

    validateSession();
  }, [router]);

  function signOut() {
    deleteCookie("wfl-session");
    deleteCookie("wfl-user");
    router.replace("/login");
  }

  // Show loading state while authenticating
  if (isAuthenticating) {
    return (
      <aside className="flex flex-col w-56 h-screen bg-zinc-900 border-r border-zinc-800 shrink-0">
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col w-56 h-screen bg-zinc-900 border-r border-zinc-800 shrink-0">

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-20 border-b border-zinc-800 shrink-0">
        <WaffleLogo className="h-14 w-14" />
        <div className="space-y-0.5">
          <div className="text-lg font-medium text-zinc-100">{APP_NAME}</div>
          <div className="text-xs text-yellow-400 font-medium">HEAD OF DEPARTMENT</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-6">
        <ul className="px-4 space-y-1">
          {NAV.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User */}
      <div className="border-t border-zinc-800 p-4 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-200 truncate">
              {user?.name || "HOD"}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {user?.roll || ""}
            </div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-2 w-full text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </div>
    </aside>
  );
}