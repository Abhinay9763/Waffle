"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getCookie } from "cookies-next";
import { useParams } from "next/navigation";
import {
  Loader2, RefreshCw, Radio, CheckCircle2, Clock3, RotateCcw, AlertCircle,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const POLL_MS = 10_000;

// ── Types ──────────────────────────────────────────────────────────────────

interface ExamInfo {
  id: number; name: string; start: string; end: string; total_marks: number;
}
interface ActiveStudent {
  student_name: string; student_roll: string;
  last_seen_at: string;  answered: number; total: number;
}
interface SubmittedStudent {
  student_name: string; student_roll: string;
  submitted_at: string; user_id: number;
}
interface LogEntry {
  event: string; created_at: string;
  Users: { name: string; roll: string };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function secsAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

function fmtSecsAgo(secs: number) {
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function timeLeft(endIso: string) {
  const diff = Math.max(0, Math.floor((new Date(endIso).getTime() - Date.now()) / 1000));
  if (diff === 0) return "Ended";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2, "0")}m left`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} left`;
}

const EVENT_META: Record<string, { label: string; dot: string; text: string }> = {
  joined:         { label: "joined",         dot: "bg-emerald-500", text: "text-emerald-400" },
  submitted:      { label: "submitted",      dot: "bg-yellow-400",  text: "text-yellow-400"  },
  retake_granted: { label: "retake granted", dot: "bg-purple-400",  text: "text-purple-400"  },
};

// ── Component ──────────────────────────────────────────────────────────────

export default function LiveControlCentre() {
  const { examId } = useParams<{ examId: string }>();

  const [exam, setExam] = useState<ExamInfo | null>(null);
  const [active, setActive] = useState<ActiveStudent[]>([]);
  const [idle, setIdle] = useState<ActiveStudent[]>([]);
  const [submitted, setSubmitted] = useState<SubmittedStudent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retaking, setRetaking] = useState<number | null>(null);
  const [, tick] = useState(0); // forces 1s re-render for live countdowns

  const token = useRef<string>("");

  const fetchAll = useCallback(async (isInit = false) => {
    if (!isInit) setPolling(true);
    const t = token.current;
    try {
      const [liveRes, logRes] = await Promise.all([
        fetch(`${API}/exam/${examId}/live`,  { headers: { "x-session-token": t } }),
        fetch(`${API}/exam/${examId}/logs`,  { headers: { "x-session-token": t } }),
      ]);
      if (!liveRes.ok) { setError("Could not load exam data."); return; }
      const live = await liveRes.json();
      const logData = logRes.ok ? await logRes.json() : { logs: [] };
      setExam(live.exam);
      setActive(live.active ?? []);
      setIdle(live.idle ?? []);
      setSubmitted(live.submitted ?? []);
      setLogs(logData.logs ?? []);
      setError(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
      setPolling(false);
    }
  }, [examId]);

  useEffect(() => {
    token.current = (getCookie("wfl-session") as string | undefined) ?? "";
    fetchAll(true);
    const poll = setInterval(() => fetchAll(), POLL_MS);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [fetchAll]);

  const handleRetake = useCallback(async (userId: number, studentName: string) => {
    if (!confirm(`Allow ${studentName} to retake? Their current submission will be discarded.`)) return;
    setRetaking(userId);
    try {
      await fetch(`${API}/exam/${examId}/retake`, {
        method: "POST",
        headers: { "x-session-token": token.current, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      await fetchAll();
    } finally {
      setRetaking(null);
    }
  }, [examId, fetchAll]);

  // ── Loading / error states ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (error || !exam) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-zinc-500 text-sm">
        <AlertCircle className="w-4 h-4" /> {error ?? "Exam not found."}
      </div>
    );
  }

  const total = active.length + idle.length + submitted.length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="shrink-0 px-8 py-5 border-b border-zinc-800 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <Radio className="w-4 h-4 text-emerald-400 shrink-0" />
            <h1 className="text-base font-semibold text-zinc-100 truncate">{exam.name}</h1>
            {polling && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-600 shrink-0" />}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 pl-6.5">{timeLeft(exam.end)}</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500 shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {active.length} active
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
            {idle.length} idle
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" />
            {submitted.length} submitted
          </span>
          <span className="text-zinc-600">{total} total</span>
          <button
            onClick={() => fetchAll()}
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Refresh now"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body — two columns */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: student lists */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8 border-r border-zinc-800">

          {/* Active */}
          <Section
            icon={<span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />}
            title="Active"
            count={active.length}
            empty="No students currently active."
          >
            {active.map((s) => (
              <StudentRow key={s.student_roll} name={s.student_name} roll={s.student_roll}>
                <ProgressBar answered={s.answered} total={s.total} />
                <span className="text-[11px] text-zinc-600 shrink-0">
                  {fmtSecsAgo(secsAgo(s.last_seen_at))}
                </span>
              </StudentRow>
            ))}
          </Section>

          {/* Idle */}
          <Section
            icon={<Clock3 className="w-3.5 h-3.5 text-yellow-500" />}
            title="Idle"
            count={idle.length}
            empty="No idle students."
          >
            {idle.map((s) => (
              <StudentRow key={s.student_roll} name={s.student_name} roll={s.student_roll}>
                <ProgressBar answered={s.answered} total={s.total} />
                <span className="text-[11px] text-yellow-600 shrink-0">
                  {fmtSecsAgo(secsAgo(s.last_seen_at))}
                </span>
              </StudentRow>
            ))}
          </Section>

          {/* Submitted */}
          <Section
            icon={<CheckCircle2 className="w-3.5 h-3.5 text-zinc-500" />}
            title="Submitted"
            count={submitted.length}
            empty="No submissions yet."
          >
            {submitted.map((s) => (
              <StudentRow key={s.student_roll} name={s.student_name} roll={s.student_roll}>
                <span className="text-[11px] text-zinc-600 shrink-0">{fmtTime(s.submitted_at)}</span>
                <button
                  onClick={() => handleRetake(s.user_id, s.student_name)}
                  disabled={retaking === s.user_id}
                  className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md
                    border border-zinc-700 text-zinc-400 hover:border-amber-700 hover:text-amber-400
                    hover:bg-amber-950/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {retaking === s.user_id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RotateCcw className="w-3 h-3" />}
                  Allow retake
                </button>
              </StudentRow>
            ))}
          </Section>

        </div>

        {/* Right: event log */}
        <div className="w-72 shrink-0 overflow-y-auto px-5 py-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-4">
            Event log
          </p>
          {logs.length === 0 ? (
            <p className="text-xs text-zinc-600">No events yet.</p>
          ) : (
            <ul className="space-y-3">
              {logs.map((l, i) => {
                const meta = EVENT_META[l.event] ?? { label: l.event, dot: "bg-zinc-500", text: "text-zinc-400" };
                return (
                  <li key={i} className="flex items-start gap-2.5 text-xs">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                    <div className="min-w-0">
                      <span className="text-zinc-300 font-medium truncate block">
                        {l.Users?.name ?? "—"}
                      </span>
                      <span className={`${meta.text}`}>{meta.label}</span>
                      <span className="text-zinc-600 ml-1.5">{fmtTime(l.created_at)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Section({
  icon, title, count, empty, children,
}: {
  icon: React.ReactNode; title: string; count: number;
  empty: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs font-semibold text-zinc-400">{title}</span>
        <span className="text-xs text-zinc-600 bg-zinc-800/60 px-1.5 py-0.5 rounded-full">{count}</span>
      </div>
      {count === 0 ? (
        <p className="text-xs text-zinc-700 pl-5">{empty}</p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  );
}

function StudentRow({
  name, roll, children,
}: {
  name: string; roll: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-200 truncate">{name}</p>
        <p className="text-[11px] text-zinc-600">{roll}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

function ProgressBar({ answered, total }: { answered: number; total: number }) {
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-600 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-zinc-600 tabular-nums">{answered}/{total}</span>
    </div>
  );
}
