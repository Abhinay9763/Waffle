"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getCookie } from "cookies-next";
import { CalendarClock, FileText, Loader2, CheckCircle2, Plus, Clock } from "lucide-react";
import Link from "next/link";
import { API } from "@/lib/config";

interface Paper {
  id: number;
  name: string;
  total_marks: number;
}

const schema = z
  .object({
    name: z.string().min(1, "Exam name is required"),
    questionpaper_id: z.coerce.number().min(1, "Select a question paper"),
    start: z.string().min(1, "Start time is required"),
    end: z.string().min(1, "End time is required"),
    duration_minutes: z.coerce.number().min(1, "Duration must be at least 1 minute"),
    max_warnings: z.coerce.number().int().min(1, "Must be at least 1 warning").max(20, "Keep this at 20 or less"),
    join_window: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
      z.number().int().min(1, "Must be at least 1 minute").optional(),
    ),
  })
  .refine((d) => new Date(d.start) > new Date(), {
    message: "Start time cannot be in the past",
    path: ["start"],
  })
  .refine((d) => new Date(d.end) > new Date(d.start), {
    message: "End time must be after start time",
    path: ["end"],
  });

type FormData = z.infer<typeof schema>;

// ── Field label ───────────────────────────────────────────────────────────────

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-300">
      {children}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-400">{message}</p>;
}

// ── Success state ─────────────────────────────────────────────────────────────

function SuccessState({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-6">
      <div className="rounded-full bg-emerald-950/40 p-4 border border-emerald-800/40">
        <CheckCircle2 className="w-7 h-7 text-emerald-400" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-zinc-100">Exam scheduled</h2>
        <p className="text-sm text-zinc-500">
          <span className="text-zinc-300 font-medium">{name}</span> is ready to go.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/exams"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
        >
          View all exams
        </Link>
        <Link
          href="/exams/new"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-yellow-400 hover:bg-yellow-300 text-zinc-900 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Schedule another
        </Link>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExamScheduleForm() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [papersLoading, setPapersLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [minDatetime, setMinDatetime] = useState("");

  useEffect(() => {
    const now = new Date();
    setMinDatetime(
      new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    );
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      duration_minutes: 120, // Default to 2 hours
      max_warnings: 3,
    }
  });

  const paperIdVal = watch("questionpaper_id");
  const startTime = watch("start");
  const duration = watch("duration_minutes");
  const selectedPaper = papers.find((p) => p.id === Number(paperIdVal));

  // Auto-update end time when start time or duration changes
  useEffect(() => {
    if (startTime && duration) {
      const start = new Date(startTime);
      const end = new Date(start.getTime() + duration * 60000); // duration in minutes
      const endDatetime = new Date(end.getTime() - end.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setValue("end", endDatetime);
    }
  }, [startTime, duration, setValue]);

  useEffect(() => {
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setPapersLoading(false); return; }

    fetch(`${API}/paper/list`, { headers: { "x-session-token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPapers(d.papers ?? []))
      .catch(() => {})
      .finally(() => setPapersLoading(false));
  }, []);

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    const token = getCookie("wfl-session") as string | undefined;
    if (!token) { setServerError("Session expired. Please sign in again."); return; }

    let res: Response | null = null;
    try {
      res = await fetch(`${API}/exam/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": token },
        body: JSON.stringify({
          name: data.name,
          questionpaper_id: data.questionpaper_id,
          total_marks: selectedPaper?.total_marks ?? 0,
          start: new Date(data.start).toISOString(),
          end: new Date(data.end).toISOString(),
          creator_id: 0,
          max_warnings: data.max_warnings,
          join_window: data.join_window ?? null,
        }),
      });
    } catch {
      setServerError("Network error — is the server running?");
      return;
    }

    if (res.ok) {
      setCreated(data.name);
    } else {
      const body = await res.json().catch(() => ({}));
      setServerError(body.detail ?? "Failed to create exam.");
    }
  };

  const setStartTimeToNow = () => {
    const now = new Date();
    // Add 1 minute 30 seconds (90 seconds)
    now.setSeconds(now.getSeconds() + 90);
    const localDatetime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setValue("start", localDatetime);
  };

  if (created) return <SuccessState name={created} />;

  const inputBase =
    "w-full rounded-lg border bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:ring-2 focus:ring-yellow-500/70 focus:border-yellow-500";
  const inputNormal = "border-zinc-800 hover:border-zinc-700";
  const inputError = "border-red-800 focus:ring-red-700/50 focus:border-red-700";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-10 space-y-8">

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-yellow-400 mb-1">
            <CalendarClock className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wider">New exam</span>
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">Schedule an exam</h1>
          <p className="text-sm text-zinc-500">
            Select a question paper and set the time window.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">

          {serverError && (
            <div className="rounded-lg bg-red-950/50 border border-red-900/60 px-3.5 py-3 text-sm text-red-400">
              {serverError}
            </div>
          )}

          {/* Exam name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">Exam name</Label>
            <input
              id="name"
              placeholder="e.g. Mid-Semester Exam 2025"
              {...register("name")}
              className={`${inputBase} ${errors.name ? inputError : inputNormal}`}
            />
            <FieldError message={errors.name?.message} />
          </div>

          {/* Question paper */}
          <div className="space-y-1.5">
            <Label htmlFor="questionpaper_id">Question paper</Label>

            {papersLoading ? (
              <div className="h-[42px] rounded-lg border border-zinc-800 bg-zinc-900 flex items-center px-3.5 gap-2 text-sm text-zinc-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading papers…
              </div>
            ) : papers.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3.5 py-3 space-y-1">
                <p className="text-sm text-zinc-500">No question papers found.</p>
                <Link
                  href="/papers/new"
                  className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
                >
                  Create a paper first →
                </Link>
              </div>
            ) : (
              <select
                id="questionpaper_id"
                {...register("questionpaper_id")}
                className={`${inputBase} ${errors.questionpaper_id ? inputError : inputNormal}`}
                style={{ colorScheme: "dark" }}
              >
                <option value="">Select a paper…</option>
                {papers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            <FieldError message={errors.questionpaper_id?.message} />

            {selectedPaper && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span>{selectedPaper.total_marks} marks total</span>
              </div>
            )}
          </div>

          {/* Time window */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="start">Start time</Label>
                <button
                  type="button"
                  onClick={setStartTimeToNow}
                  className="text-xs text-yellow-400 hover:text-yellow-300 border border-yellow-600 hover:border-yellow-400 bg-yellow-950/30 hover:bg-yellow-950/50 px-2 py-1 rounded transition-colors flex items-center gap-1"
                >
                  <Clock className="w-3 h-3" />
                  Now
                </button>
              </div>
              <input
                id="start"
                type="datetime-local"
                min={minDatetime}
                {...register("start")}
                className={`${inputBase} ${errors.start ? inputError : inputNormal}`}
                style={{ colorScheme: "dark" }}
              />
              <FieldError message={errors.start?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">End time</Label>
              <input
                id="end"
                type="datetime-local"
                {...register("end")}
                className={`${inputBase} ${errors.end ? inputError : inputNormal}`}
                style={{ colorScheme: "dark" }}
              />
              <FieldError message={errors.end?.message} />
            </div>
          </div>

          {/* Duration helper */}
          <div className="space-y-1.5">
            <Label htmlFor="duration_minutes">Quick set duration</Label>
            <select
              id="duration_minutes"
              {...register("duration_minutes")}
              className={`${inputBase} ${errors.duration_minutes ? inputError : inputNormal}`}
              style={{ colorScheme: "dark" }}
            >
              <option value="">Select duration to auto-fill end time…</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">1 hour</option>
              <option value="90">1.5 hours</option>
              <option value="120">2 hours</option>
              <option value="150">2.5 hours</option>
              <option value="180">3 hours</option>
              <option value="240">4 hours</option>
              <option value="300">5 hours</option>
            </select>
            <FieldError message={errors.duration_minutes?.message} />
            {startTime && duration && (
              <p className="text-xs text-zinc-500">
                Will end at {new Date(new Date(startTime).getTime() + duration * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </p>
            )}
          </div>

          {/* Join window */}
          <div className="space-y-1.5">
            <Label htmlFor="join_window">
              Join window <span className="text-zinc-600 font-normal">(optional)</span>
            </Label>
            <div className="flex items-center gap-2">
              <input
                id="join_window"
                type="number"
                min={1}
                placeholder="e.g. 15"
                {...register("join_window")}
                className={`w-32 rounded-lg border bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:ring-2 focus:ring-yellow-500/70 focus:border-yellow-500 ${errors.join_window ? inputError : inputNormal}`}
              />
              <span className="text-sm text-zinc-500">minutes after start</span>
            </div>
            <p className="text-xs text-zinc-600">Students cannot join after this many minutes. Leave blank for no limit.</p>
            <FieldError message={errors.join_window?.message} />
          </div>

          {/* Max warnings */}
          <div className="space-y-1.5">
            <Label htmlFor="max_warnings">Max warnings</Label>
            <div className="flex items-center gap-2">
              <input
                id="max_warnings"
                type="number"
                min={1}
                max={20}
                {...register("max_warnings")}
                className={`w-32 rounded-lg border bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:ring-2 focus:ring-yellow-500/70 focus:border-yellow-500 ${errors.max_warnings ? inputError : inputNormal}`}
              />
              <span className="text-sm text-zinc-500">violations before auto-submit</span>
            </div>
            <p className="text-xs text-zinc-600">Recommended: 3. Student is temporarily locked after each violation and auto-submitted at this limit.</p>
            <FieldError message={errors.max_warnings?.message} />
          </div>

          {/* Submit */}
          <div className="pt-1">
            <button
              type="submit"
              disabled={isSubmitting || papers.length === 0}
              className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? "Scheduling…" : "Schedule exam"}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
