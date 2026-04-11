"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, FileText, CalendarDays, BarChart2, LogOut, Loader2 } from "lucide-react";
import { WaffleLogo } from "@/components/WaffleLogo";
import { getCookie, deleteCookie } from "cookies-next";
import { API, APP_NAME } from "@/lib/config";

const NAV = [
  { label: "Question Papers",  href: "/papers",    icon: FileText },
  { label: "Exams",            href: "/exams",     icon: CalendarDays },
  { label: "Results",          href: "/responses", icon: BarChart2 },
];

export default function FacultySidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; roll: string; role?: string } | null>(null);
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

        // Shared pages are available to Faculty and HOD.
        if (sessionData.user?.role !== "Faculty" && sessionData.user?.role !== "HOD") {
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

      {(() => {
        const dashboardHref = user?.role === "HOD" ? "/hod" : "/faculty";
        const roleLabel = user?.role === "HOD" ? "HOD" : "FACULTY";
        const roleClass = user?.role === "HOD"
          ? "text-yellow-400 border-yellow-800/50 bg-yellow-950/30"
          : "text-purple-400 border-purple-800/50 bg-purple-950/30";
        const nav = [{ label: "Dashboard", href: dashboardHref, icon: LayoutDashboard }, ...NAV];

        return (
          <>

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-20 border-b border-zinc-800 shrink-0">
        <span className="text-yellow-400">
          <WaffleLogo size={72} />
        </span>
        <span className="text-lg font-semibold text-zinc-100 tracking-tight">{APP_NAME}</span>
        <span className={`ml-auto text-[10px] font-medium border rounded px-1.5 py-0.5 ${roleClass}`}>
          {roleLabel}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");

          return (
            <Link
              key={href}
              href={href}
              className={`
                flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                ${active
                  ? "bg-yellow-500/10 text-yellow-300 border border-yellow-700/40"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                }
              `}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-zinc-800 space-y-0.5 shrink-0">
        <div className="px-3 py-2 rounded-lg">
          <p className="text-xs font-medium text-zinc-300 truncate">{user?.name ?? "User"}</p>
          <p className="text-[11px] text-zinc-600 truncate">{user?.roll ?? ""}</p>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>

          </>
        );
      })()}
      

    </aside>
  );
}
