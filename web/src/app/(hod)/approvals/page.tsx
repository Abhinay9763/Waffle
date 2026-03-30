"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import { UserCheck, UserX, Clock, Mail, Calendar, Loader2 } from "lucide-react";
import { API } from "@/lib/config";

interface PendingFaculty {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

export default function FacultyApprovals() {
  const [pendingFaculty, setPendingFaculty] = useState<PendingFaculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);

  useEffect(() => {
    fetchPendingFaculty();
  }, []);

  const fetchPendingFaculty = async () => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/hod/pending-faculty`, {
      headers: { "x-session-token": token },
    })
      .then((r) => (r.ok ? r.json() : { pending_faculty: [] }))
      .then((d) => setPendingFaculty(d.pending_faculty ?? []))
      .catch(() => setPendingFaculty([]))
      .finally(() => setLoading(false));
  };

  const handleApproval = async (facultyId: number, action: 'approve' | 'reject') => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token || processingId !== null) return;

    setProcessingId(facultyId);

    try {
      const res = await fetch(`${API}/hod/${action}-faculty/${facultyId}`, {
        method: "POST",
        headers: { "x-session-token": token },
      });

      if (res.ok) {
        // Remove the faculty member from the list
        setPendingFaculty(prev => prev.filter(f => f.id !== facultyId));
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body.detail ?? `Failed to ${action} faculty member`);
      }
    } catch {
      alert(`Network error: Could not ${action} faculty member`);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-100">Faculty Approvals</h1>
          <p className="text-sm text-zinc-500">
            Review and approve faculty registration requests.
          </p>
        </div>

        {/* Content */}
        {pendingFaculty.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-4 rounded-full bg-zinc-800/50 mb-4">
              <UserCheck className="w-8 h-8 text-zinc-500" />
            </div>
            <h2 className="text-lg font-medium text-zinc-300 mb-2">All caught up!</h2>
            <p className="text-sm text-zinc-500 max-w-md">
              There are no faculty members waiting for approval at the moment.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Clock className="w-4 h-4" />
              {pendingFaculty.length} faculty member{pendingFaculty.length !== 1 ? 's' : ''} awaiting approval
            </div>

            <div className="space-y-3">
              {pendingFaculty.map((faculty) => (
                <div
                  key={faculty.id}
                  className="flex items-center gap-4 p-6 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50 transition-colors"
                >
                  {/* Faculty Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                        <span className="text-sm font-medium text-zinc-300">
                          {faculty.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-zinc-200 truncate">
                          {faculty.name}
                        </h3>
                        <div className="flex items-center gap-3 text-xs text-zinc-500">
                          <div className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {faculty.email}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(faculty.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleApproval(faculty.id, 'approve')}
                      disabled={processingId === faculty.id}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-green-50 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {processingId === faculty.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <UserCheck className="w-4 h-4" />
                      )}
                      Approve
                    </button>
                    <button
                      onClick={() => handleApproval(faculty.id, 'reject')}
                      disabled={processingId === faculty.id}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-red-50 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {processingId === faculty.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <UserX className="w-4 h-4" />
                      )}
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}