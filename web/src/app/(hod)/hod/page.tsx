"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import { Users, UserCheck, UserX, Loader2 } from "lucide-react";
import Link from "next/link";
import { API } from "@/lib/config";

export default function HODDashboard() {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/hod/pending-faculty`, {
      headers: { "x-session-token": token },
    })
      .then((r) => (r.ok ? r.json() : { pending_faculty: [] }))
      .then((d) => setPendingCount(d.pending_faculty?.length ?? 0))
      .catch(() => setPendingCount(0))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-8">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-100">HOD Dashboard</h1>
          <p className="text-sm text-zinc-500">
            Manage faculty approvals and oversee the examination system.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Pending Approvals */}
          <Link
            href="/approvals"
            className="block p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 transition-colors group"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-900/40 group-hover:bg-amber-950/60 transition-colors">
                <Users className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-zinc-100">
                  {pendingCount ?? 0}
                </div>
                <div className="text-sm text-zinc-500">Pending Faculty</div>
                {pendingCount !== null && pendingCount > 0 && (
                  <div className="text-xs text-amber-400 mt-1">Requires approval</div>
                )}
              </div>
            </div>
          </Link>

          {/* Quick Actions */}
          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/50">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-green-950/40 border border-green-900/40">
                <UserCheck className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">Faculty Management</div>
                <div className="text-xs text-zinc-500 mt-1">Approve or reject new faculty</div>
              </div>
            </div>
          </div>

          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/50">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-900/40">
                <UserX className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-200">System Oversight</div>
                <div className="text-xs text-zinc-500 mt-1">Monitor exams and results</div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        {pendingCount !== null && pendingCount > 0 && (
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-6">
            <div className="flex items-center gap-4">
              <Users className="w-8 h-8 text-amber-400" />
              <div className="flex-1">
                <h3 className="text-lg font-medium text-amber-100">
                  {pendingCount} faculty member{pendingCount !== 1 ? 's' : ''} awaiting approval
                </h3>
                <p className="text-sm text-amber-200/70 mt-1">
                  Review and approve new faculty registrations to grant them access to the system.
                </p>
              </div>
              <Link
                href="/approvals"
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-amber-50 text-sm font-medium transition-colors"
              >
                Review Now
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}