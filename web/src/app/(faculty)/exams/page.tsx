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

function statusOf(start: string, end: string): "live" | "upcoming" | "ended" {
  const now = Date.now();
  if (now < new Date(start).getTime()) return "upcoming";
  if (now <= new Date(end).getTime()) return "live";
  return "ended";
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function timeUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STATUS_STYLE = {
  live:     "text-emerald-400 bg-emerald-950/40 border-emerald-800/50",
  upcoming: "text-sky-400    bg-sky-950/40    border-sky-800/50",
  ended:    "text-zinc-500   bg-zinc-800/40   border-zinc-700/50",
};
const STATUS_LABEL = { live: "Live", upcoming: "Upcoming", ended: "Ended" };

function ExamRow({ exam }: { exam: Exam }) {
  const status = statusOf(exam.start, exam.end);
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-800/30 transition-colors">
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-zinc-200 truncate">{exam.name}</p>
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          <span className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            {fmtDatetime(exam.start)}
          </span>
          <span>{exam.total_marks} marks</span>
          {status === "live" && (
            <span className="text-emerald-600">ends in {timeUntil(exam.end)}</span>
          )}
          {status === "upcoming" && (
            <span>in {timeUntil(exam.start)}</span>
          )}
        </div>
      </div>
      <span className={`shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded border ${STATUS_STYLE[status]}`}>
        {STATUS_LABEL[status]}
      </span>
      {status === "live" && (
        <Link
          href={`/exams/${exam.id}/live`}
          className="shrink-0 flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/50 hover:border-emerald-700 px-2.5 py-1 rounded-lg transition-colors"
        >
          <Radio className="w-3 h-3" />
          Control Centre
        </Link>
      )}
      <Link
        href={`/responses/${exam.id}`}
        className="shrink-0 flex items-center gap-1 text-xs text-zinc-500 hover:text-yellow-400 border border-zinc-700 hover:border-yellow-600 px-2.5 py-1 rounded-lg transition-colors"
      >
        {status === "live" ? "Live view" : "Results"}
        <ChevronRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    fetch(`${API}/exam/list`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : { exams: [] }))
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

  if (exams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <p className="text-zinc-500 text-sm">No exams scheduled yet.</p>
        <Link
          href="/exams/new"
          className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Schedule your first exam
        </Link>
      </div>
    );
  }

  const live     = exams.filter((e) => statusOf(e.start, e.end) === "live");
  const upcoming = exams.filter((e) => statusOf(e.start, e.end) === "upcoming");
  const ended    = exams.filter((e) => statusOf(e.start, e.end) === "ended");

  const groups: { label: string; icon?: React.ReactNode; exams: Exam[] }[] = [
    { label: "Live",     icon: <Radio className="w-3.5 h-3.5 text-emerald-500" />, exams: live },
    { label: "Upcoming", exams: upcoming },
    { label: "Ended",    exams: ended },
  ].filter((g) => g.exams.length > 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-6">

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold text-zinc-100">Exams</h1>
            <p className="text-sm text-zinc-500">{exams.length} exam{exams.length !== 1 ? "s" : ""}</p>
          </div>
          <Link
            href="/exams/new"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-zinc-900 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Schedule exam
          </Link>
        </div>

        {groups.map(({ label, icon, exams: groupExams }) => (
          <section key={label} className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {icon}
              {label}
            </div>
            <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60">
              {groupExams.map((e) => <ExamRow key={e.id} exam={e} />)}
            </div>
          </section>
        ))}

      </div>
    </div>
  );
}
