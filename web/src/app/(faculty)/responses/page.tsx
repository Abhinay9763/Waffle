"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { CalendarDays, ChevronRight, Loader2, Plus, Radio } from "lucide-react";
import { API } from "@/lib/config";

interface Exam {
  id: number;
  name: string;
  total_marks: number;
  start: string;
  end: string;
}

function statusOf(start: string, end: string): "upcoming" | "live" | "ended" {
  const now = Date.now();
  if (now < new Date(start).getTime()) return "upcoming";
  if (now <= new Date(end).getTime()) return "live";
  return "ended";
}

const STATUS: Record<"upcoming" | "live" | "ended", { label: string; className: string }> = {
  upcoming: { label: "Upcoming", className: "text-sky-400 bg-sky-950/40 border-sky-800/50" },
  live: { label: "Live", className: "text-emerald-400 bg-emerald-950/40 border-emerald-800/50" },
  ended: { label: "Ended", className: "text-zinc-500 bg-zinc-800/40 border-zinc-700/50" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ResponsesPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/exam/list`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setExams(d.exams ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (!exams.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <p className="text-zinc-500 text-sm">No exams yet.</p>
        <Link
          href="/exams/new"
          className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Schedule an exam
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-3">

        <div className="space-y-1 mb-6">
          <h1 className="text-xl font-semibold text-zinc-100">Results</h1>
          <p className="text-sm text-zinc-500">View student submissions for each exam.</p>
        </div>

        {exams.map((exam) => {
          const s = statusOf(exam.start, exam.end);
          const badge = STATUS[s];
          return (
            <div
              key={exam.id}
              className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-zinc-800 bg-zinc-900"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium text-zinc-100 truncate">{exam.name}</span>
                  <span
                    className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-600">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    {fmtDate(exam.start)} – {fmtDate(exam.end)}
                  </span>
                  <span>{exam.total_marks} marks</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {s === "live" && (
                  <Link
                    href={`/exams/${exam.id}/live`}
                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg
                      bg-emerald-950/40 border border-emerald-800/50 text-emerald-400
                      hover:bg-emerald-900/40 hover:border-emerald-700 transition-colors"
                  >
                    <Radio className="w-3 h-3" />
                    Control Centre
                  </Link>
                )}
                <Link
                  href={`/responses/${exam.id}`}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  Results
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          );
        })}

      </div>
    </div>
  );
}
