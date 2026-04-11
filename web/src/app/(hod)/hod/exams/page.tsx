"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { CalendarDays, ChevronRight, Loader2, Plus, Radio, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/lib/config";

interface Exam {
  id: number;
  name: string;
  total_marks: number;
  start: string;
  end: string;
  can_manage: boolean;
}

function statusOf(start: string, end: string): "live" | "upcoming" | "ended" {
  const now = Date.now();
  if (now < new Date(start).getTime()) return "upcoming";
  if (now <= new Date(end).getTime()) return "live";
  return "ended";
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_STYLE = {
  live: "text-emerald-400 bg-emerald-950/40 border-emerald-800/50",
  upcoming: "text-sky-400 bg-sky-950/40 border-sky-800/50",
  ended: "text-zinc-500 bg-zinc-800/40 border-zinc-700/50",
};

export default function HodExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/exam/list`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : { exams: [] }))
      .then((d) => setExams(d.exams ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (exam: Exam) => {
    if (!confirm(`Delete "${exam.name}"? This cannot be undone.`)) return;
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) return;

    setDeletingId(exam.id);
    const res = await fetch(`${API}/exam/${exam.id}`, {
      method: "DELETE",
      headers: { "x-session-token": token },
    }).catch(() => null);
    setDeletingId(null);

    if (res?.ok) {
      setExams((prev) => prev.filter((e) => e.id !== exam.id));
      return;
    }

    const body = await res?.json().catch(() => ({}));
    toast.error(body?.detail ?? "Failed to delete exam.");
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Exams</h1>
            <p className="text-sm text-zinc-500">{exams.length} exam{exams.length !== 1 ? "s" : ""}</p>
          </div>
          <Link href="/hod/exams/new" className="flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-yellow-300">
            <Plus className="h-3.5 w-3.5" /> Schedule exam
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60">
          {exams.map((exam) => {
            const s = statusOf(exam.start, exam.end);
            return (
              <div key={exam.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-800/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">{exam.name}</p>
                  <div className="flex items-center gap-3 text-xs text-zinc-600">
                    <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{fmtDatetime(exam.start)}</span>
                    <span>{exam.total_marks} marks</span>
                  </div>
                </div>
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${STATUS_STYLE[s]}`}>{s}</span>
                {s === "live" && (
                  <Link href={`/hod/exams/${exam.id}/live`} className="flex items-center gap-1 rounded-lg border border-emerald-800/50 px-2.5 py-1 text-xs text-emerald-400 hover:border-emerald-700">
                    <Radio className="h-3 w-3" /> Live
                  </Link>
                )}
                <Link href={`/hod/responses/${exam.id}`} className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200">
                  Results <ChevronRight className="h-3.5 w-3.5" />
                </Link>
                {s !== "live" && exam.can_manage && (
                  <button
                    onClick={() => handleDelete(exam)}
                    disabled={deletingId === exam.id}
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400"
                    title="Delete exam"
                  >
                    {deletingId === exam.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            );
          })}
          {exams.length === 0 && <div className="px-4 py-10 text-center text-sm text-zinc-500">No exams scheduled yet.</div>}
        </div>
      </div>
    </div>
  );
}
