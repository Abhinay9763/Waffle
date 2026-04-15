"use client";

import { useState, useEffect } from "react";
import { getCookie } from "cookies-next";
import Link from "next/link";
import { CalendarDays, ChevronRight, Loader2, Pencil, Plus, Radio, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/lib/config";

interface Exam {
  id: number;
  name: string;
  total_marks: number;
  start: string;
  end: string;
  can_manage: boolean;
  responses_released?: boolean;
  release_after_exam?: boolean;
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

function ExamRow({ exam, onDelete, deleting, onRelease, releasing }: {
  exam: Exam;
  onDelete: () => void;
  deleting: boolean;
  onRelease: () => void;
  releasing: boolean;
}) {
  const status = statusOf(exam.start, exam.end);
  const canReleaseNow = status === "ended" && exam.can_manage && !exam.responses_released;
  const canModify = status === "upcoming" && exam.can_manage;

  return (
    <div className="flex flex-col items-stretch gap-3 px-4 py-3.5 hover:bg-zinc-800/30 transition-colors sm:flex-row sm:items-center sm:gap-4">
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-zinc-200 truncate">{exam.name}</p>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-zinc-600">
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
      <span className={`self-start sm:self-auto shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded border ${STATUS_STYLE[status]}`}>
        {STATUS_LABEL[status]}
      </span>
      <div className="flex flex-wrap items-center gap-2 sm:gap-2 sm:ml-auto">
      {canModify && (
        <Link
          href={`/hod/exams/${exam.id}/edit`}
          className="shrink-0 flex items-center gap-1 text-xs text-zinc-400 hover:text-sky-300 border border-zinc-700 hover:border-sky-700 px-2.5 py-1 rounded-lg transition-colors"
          title="Modify exam"
        >
          <Pencil className="w-3 h-3" />
          Modify
        </Link>
      )}
      {status === "live" && (
        <Link
          href={`/hod/exams/${exam.id}/live`}
          className="shrink-0 flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/50 hover:border-emerald-700 px-2.5 py-1 rounded-lg transition-colors"
        >
          <Radio className="w-3 h-3" />
          Control Centre
        </Link>
      )}
      <Link
        href={`/hod/responses/${exam.id}`}
        className="shrink-0 flex items-center gap-1 text-xs text-zinc-500 hover:text-yellow-400 border border-zinc-700 hover:border-yellow-600 px-2.5 py-1 rounded-lg transition-colors"
      >
        {status === "live" ? "Live view" : "Results"}
        <ChevronRight className="w-3.5 h-3.5" />
      </Link>
      {canReleaseNow && (
        <button
          onClick={onRelease}
          disabled={releasing}
          className="shrink-0 rounded-lg border border-emerald-800/60 px-2.5 py-1 text-xs text-emerald-300 transition-colors hover:border-emerald-700 hover:bg-emerald-950/20 disabled:cursor-not-allowed disabled:opacity-60"
          title="Release responses to students"
        >
          {releasing ? "Releasing..." : "Release responses"}
        </button>
      )}
      {status === "ended" && exam.responses_released && (
        <span className="shrink-0 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-2.5 py-1 text-xs text-emerald-300">
          Released
        </span>
      )}
      {status !== "ended" && exam.release_after_exam && (
        <span className="shrink-0 rounded-lg border border-sky-800/50 bg-sky-950/20 px-2.5 py-1 text-xs text-sky-300">
          Auto-release enabled
        </span>
      )}
      {status !== "live" && exam.can_manage && (
        <button
          onClick={onDelete}
          disabled={deleting}
          className="shrink-0 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-950/30 border border-transparent hover:border-red-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Delete exam"
        >
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      )}
      </div>
    </div>
  );
}

export default function HodExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [releasingId, setReleasingId] = useState<number | null>(null);

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

  const handleRelease = async (exam: Exam) => {
    if (!exam.can_manage) {
      toast.error("You can only view exams created by other faculty.");
      return;
    }
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) return;

    setReleasingId(exam.id);
    const res = await fetch(`${API}/exam/${exam.id}/release-responses`, {
      method: "POST",
      headers: { "x-session-token": token },
    }).catch(() => null);
    setReleasingId(null);

    if (res?.ok) {
      toast.success("Responses released to students.");
      setExams((prev) => prev.map((e) => (
        e.id === exam.id ? { ...e, responses_released: true } : e
      )));
      return;
    }

    const body = await res?.json().catch(() => ({}));
    toast.error(body?.detail ?? "Failed to release responses.");
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-600" /></div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-6 sm:px-8 sm:py-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold text-zinc-100">Exams</h1>
            <p className="text-sm text-zinc-500">{exams.length} exam{exams.length !== 1 ? "s" : ""}</p>
          </div>
          <Link
            href="/hod/exams/new"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-zinc-900 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Schedule exam
          </Link>
        </div>

        {exams.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500 rounded-xl border border-zinc-800">No exams scheduled yet.</div>
        ) : (
          (() => {
            const live = exams.filter((e) => statusOf(e.start, e.end) === "live");
            const upcoming = exams.filter((e) => statusOf(e.start, e.end) === "upcoming");
            const ended = exams.filter((e) => statusOf(e.start, e.end) === "ended");

            const groups: { label: string; exams: Exam[] }[] = [
              { label: "Live", exams: live },
              { label: "Upcoming", exams: upcoming },
              { label: "Ended", exams: ended },
            ].filter((g) => g.exams.length > 0);

            return groups.map(({ label, exams: groupExams }) => (
              <section key={label} className="space-y-2">
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</div>
                <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60">
                  {groupExams.map((e) => (
                    <ExamRow
                      key={e.id}
                      exam={e}
                      onDelete={() => handleDelete(e)}
                      deleting={deletingId === e.id}
                      onRelease={() => handleRelease(e)}
                      releasing={releasingId === e.id}
                    />
                  ))}
                </div>
              </section>
            ));
          })()
        )}
      </div>
    </div>
  );
}
