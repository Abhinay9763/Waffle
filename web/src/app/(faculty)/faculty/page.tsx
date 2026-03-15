"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { CalendarDays, ChevronRight, FileText, Loader2, Plus, Radio } from "lucide-react";
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
    weekday: "short", day: "numeric", month: "short",
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

// ── Cards ─────────────────────────────────────────────────────────────────────

function LiveCard({ exam }: { exam: Exam }) {
  return (
    <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-xs font-medium text-emerald-400">Live now</span>
          </div>
          <p className="text-sm font-medium text-zinc-100 truncate">{exam.name}</p>
          <p className="text-xs text-zinc-500">
            Ends {fmtDatetime(exam.end)}
            <span className="text-zinc-600"> · {timeUntil(exam.end)} left</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <Link
            href={`/exams/${exam.id}/live`}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg
              bg-emerald-950/40 border border-emerald-800/50 text-emerald-400
              hover:bg-emerald-900/40 hover:border-emerald-700 transition-colors"
          >
            <Radio className="w-3 h-3" />
            Control Centre
          </Link>
          <Link
            href={`/responses/${exam.id}`}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Results
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function UpcomingCard({ exam }: { exam: Exam }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3.5">
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-zinc-100 truncate">{exam.name}</p>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            {fmtDatetime(exam.start)}
          </span>
          <span>{exam.total_marks} marks</span>
        </div>
      </div>
      <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
        in {timeUntil(exam.start)}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FacultyDashboard() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [paperCount, setPaperCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setLoading(false); return; }

    const headers = { "x-session-token": token };
    Promise.all([
      fetch(`${API}/exam/list`,  { headers }).then((r) => r.ok ? r.json() : { exams: [] }),
      fetch(`${API}/paper/list`, { headers }).then((r) => r.ok ? r.json() : { papers: [] }),
    ])
      .then(([examData, paperData]) => {
        setExams(examData.exams ?? []);
        setPaperCount((paperData.papers ?? []).length);
      })
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

  const live    = exams.filter((e) => statusOf(e.start, e.end) === "live");
  const upcoming = exams.filter((e) => statusOf(e.start, e.end) === "upcoming");
  const ended   = exams.filter((e) => statusOf(e.start, e.end) === "ended");

  if (live.length === 0 && upcoming.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <p className="text-zinc-500 text-sm">No upcoming or live exams.</p>
        <div className="flex gap-2">
          <Link
            href="/papers/new"
            className="flex items-center gap-2 border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <FileText className="w-4 h-4" />
            Create a paper
          </Link>
          <Link
            href="/exams/new"
            className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Schedule an exam
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-10 space-y-8">

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-100">Dashboard</h1>
          <div className="flex gap-2">
            <Link
              href="/papers/new"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Create paper
            </Link>
            <Link
              href="/exams/new"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-zinc-900 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Schedule exam
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Papers",        value: paperCount },
            { label: "Exams hosted",  value: exams.length },
            { label: "Results ready", value: ended.length },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="text-2xl font-bold text-zinc-100 tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {live.length > 0 && (
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
              <Radio className="w-3.5 h-3.5 text-emerald-500" />
              Live
            </div>
            {live.map((e) => <LiveCard key={e.id} exam={e} />)}
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Coming up
            </p>
            {upcoming.map((e) => <UpcomingCard key={e.id} exam={e} />)}
          </section>
        )}

      </div>
    </div>
  );
}
