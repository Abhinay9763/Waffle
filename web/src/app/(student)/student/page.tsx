"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import { CalendarDays, Loader2, Radio, RefreshCw } from "lucide-react";
import { toast } from "sonner";
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

export default function StudentDashboard() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startingExamId, setStartingExamId] = useState<number | null>(null);

  const loadExams = async (silent = false) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      setExams([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (silent) setRefreshing(true);
    else setLoading(true);

    const res = await fetch(`${API}/exam/available`, {
      cache: "no-store",
      headers: { "x-session-token": token },
    }).catch(() => null);

    if (!res?.ok) {
      if (!silent) setExams([]);
      if (!silent) toast.error("Could not refresh exams right now.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const data = await res.json().catch(() => ({ exams: [] }));
    setExams(data.exams ?? []);
    setLoading(false);
    setRefreshing(false);
  };

  const handleStartExam = async (examId: number) => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) {
      toast.error("Session expired. Please login again.");
      return;
    }

    setStartingExamId(examId);
    try {
      const res = await fetch(`${API}/exam/${examId}/take`, {
        cache: "no-store",
        headers: { "x-session-token": token },
      }).catch(() => null);

      if (!res) {
        toast.error("Could not reach server. Please try again.");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.detail ?? "You cannot enter this exam now.");
        return;
      }

      window.open(`/exam/${examId}`, "_blank", "noopener,noreferrer");
    } finally {
      setStartingExamId(null);
    }
  };

  useEffect(() => {
    void loadExams(false);

    // Keep dashboard list fresh so newly scheduled exams appear automatically.
    const intervalId = window.setInterval(() => {
      void loadExams(true);
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  const live     = exams.filter((e) => statusOf(e.start, e.end) === "live");
  const upcoming = exams.filter((e) => statusOf(e.start, e.end) === "upcoming");

  if (live.length === 0 && upcoming.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <p className="text-zinc-300 text-sm font-medium">All clear!</p>
        <p className="text-zinc-600 text-xs">No upcoming or live exams at the moment.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-100">Dashboard</h1>
          <button
            type="button"
            onClick={() => {
              void loadExams(true);
            }}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Reload"}
          </button>
        </div>

        {live.length > 0 && (
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
              <Radio className="w-3.5 h-3.5 text-emerald-500" />
              Live now
            </div>
            {live.map((e) => (
              <div key={e.id} className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="text-xs font-medium text-emerald-400">In progress</span>
                </div>
                <p className="text-sm font-medium text-zinc-100">{e.name}</p>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span>Ends {fmtDatetime(e.end)}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{timeUntil(e.end)} remaining</span>
                  <span className="text-zinc-600">·</span>
                  <span>{e.total_marks} marks</span>
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleStartExam(e.id);
                    }}
                    disabled={startingExamId === e.id}
                    className="inline-flex items-center rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-yellow-300 transition-colors"
                  >
                    {startingExamId === e.id ? "Checking..." : "Start exam"}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Coming up</p>
            {upcoming.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3.5"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-zinc-100 truncate">{e.name}</p>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />
                      {fmtDatetime(e.start)}
                    </span>
                    <span>{e.total_marks} marks</span>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-zinc-500 tabular-nums">in {timeUntil(e.start)}</span>
              </div>
            ))}
          </section>
        )}

      </div>
    </div>
  );
}
