"use client";

import { useEffect, useState } from "react";
import { getCookie } from "cookies-next";
import { Loader2, Mail, UserCheck, Calendar } from "lucide-react";
import { API } from "@/lib/config";

interface FacultyMember {
  id: number;
  name: string;
  email: string;
  roll: string;
  created_at: string;
}

export default function FacultyManagementPage() {
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      setLoading(false);
      return;
    }

    fetch(`${API}/hod/faculty`, {
      headers: { "x-session-token": token },
    })
      .then((r) => (r.ok ? r.json() : { faculty: [] }))
      .then((d) => setFaculty(d.faculty ?? []))
      .catch(() => setFaculty([]))
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
      <div className="px-4 py-6 sm:px-8 sm:py-10 space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-100">Faculty Management</h1>
          <p className="text-sm text-zinc-500">Approved faculty members currently active in the system.</p>
        </div>

        {faculty.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-4 rounded-full bg-zinc-800/50 mb-4">
              <UserCheck className="w-8 h-8 text-zinc-500" />
            </div>
            <h2 className="text-lg font-medium text-zinc-300 mb-2">No approved faculty found</h2>
            <p className="text-sm text-zinc-500 max-w-md">
              Approve faculty accounts from the approvals page to see them listed here.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            {faculty.map((member, index) => (
              <div
                key={member.id}
                className={`flex items-center gap-4 p-5 bg-zinc-900/30 hover:bg-zinc-900/50 transition-colors ${
                  index !== faculty.length - 1 ? "border-b border-zinc-800/60" : ""
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                  <span className="text-sm font-medium text-zinc-300">
                    {member.name?.charAt(0)?.toUpperCase() || "F"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">{member.name}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mt-1">
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {member.email}
                    </span>
                    <span>{member.roll}</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(member.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <span className="text-[11px] font-medium px-2 py-1 rounded border border-emerald-800/50 bg-emerald-950/40 text-emerald-400 shrink-0">
                  Approved
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
