"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCookie } from "cookies-next";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Eraser, Flag, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import ExamTimer from "@/components/student/ExamTimer";
import QuestionPalette from "@/components/student/QuestionPalette";
import QuestionView from "@/components/student/QuestionView";
import PolicyOverlay from "@/components/student/PolicyOverlay";
import { ExamStructure, QuestionResponse } from "@/components/student/types";
import { API } from "@/lib/config";

export default function ExamRunner({ exam }: { exam: ExamStructure }) {
  const router = useRouter();
  const questions = useMemo(() => exam.sections.flatMap((s) => s.questions), [exam.sections]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [responses, setResponses] = useState<Record<number, QuestionResponse>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showLeavePrompt, setShowLeavePrompt] = useState(false);
  const [showSubmitPrompt, setShowSubmitPrompt] = useState(false);
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [warningCount, setWarningCount] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [lockReason, setLockReason] = useState("Please stay focused during the exam.");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [outOfFocusSecondsLeft, setOutOfFocusSecondsLeft] = useState<number | null>(null);
  const responsesRef = useRef<Record<number, QuestionResponse>>({});
  const submittedRef = useRef(false);
  const submittingRef = useRef(false);
  const exitSubmitSentRef = useRef(false);
  const heartbeatInFlightRef = useRef(false);
  const eventQueueRef = useRef<Array<{ event: string }>>([]);
  const lastViolationAtRef = useRef<Record<string, number>>({});
  const lastWarningAtRef = useRef(0);
  const outOfFocusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outOfFocusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secureModeReachedRef = useRef(false);
  const pendingDeltaRef = useRef<Record<number, QuestionResponse>>({});
  const lastFullSyncAtRef = useRef(0);
  const warningCountRef = useRef(0);

  const maxWarnings = Math.max(1, Number((exam.meta as ExamStructure["meta"] & { max_warnings?: number }).max_warnings ?? 3));

  const active = questions[activeIdx];
  const activeResponse = active ? responses[active.question_id] : undefined;

  const answeredCount = useMemo(
    () => Object.values(responses).filter((r) => r.option !== null).length,
    [responses],
  );

  const markedCount = useMemo(
    () => Object.values(responses).filter((r) => r.marked).length,
    [responses],
  );

  const token = (getCookie("wfl-session") as string | undefined) ?? "";
  const studentRoll = useMemo(() => {
    const raw = getCookie("wfl-user") as string | undefined;
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw) as { roll?: string };
      return parsed.roll ?? "";
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    warningCountRef.current = warningCount;
  }, [warningCount]);

  useEffect(() => {
    secureModeReachedRef.current = false;
  }, [exam.meta.exam_id]);

  const requestExamFullscreen = useCallback(async () => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };

    try {
      if (document.fullscreenElement) {
        setIsFullscreen(true);
        setFullscreenError(null);
        return true;
      }

      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else if (el.msRequestFullscreen) {
        await el.msRequestFullscreen();
      } else {
        setFullscreenError("Fullscreen is not supported in this browser.");
        return false;
      }

      setIsFullscreen(true);
      setFullscreenError(null);
      return true;
    } catch {
      setFullscreenError("Click Enter fullscreen to continue the exam.");
      return false;
    }
  }, []);

  useEffect(() => {
    responsesRef.current = responses;
  }, [responses]);

  useEffect(() => {
    submittedRef.current = submitted;
  }, [submitted]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const verifyCanTakeExam = useCallback(async () => {
    if (!token) return;

    const res = await fetch(`${API}/exam/${exam.meta.exam_id}/take`, {
      cache: "no-store",
      headers: { "x-session-token": token },
    }).catch(() => null);

    if (!res) return;
    if (res.ok) return;

    if (res.status === 403 || res.status === 404) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.detail ?? "You can no longer continue this exam.");
      router.replace("/history");
    }
  }, [token, exam.meta.exam_id, router]);

  useEffect(() => {
    void verifyCanTakeExam();

    const onPageShow = () => {
      void verifyCanTakeExam();
    };

    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [verifyCanTakeExam]);

  const buildSubmission = useCallback(() => {
    return {
      student_roll: studentRoll,
      responses: Object.values(responses),
    };
  }, [responses, studentRoll]);

  const sendHeartbeat = useCallback(async () => {
    if (!token || submitted || submitting) return;
    if (heartbeatInFlightRef.current) return;

    const eventsToSend = eventQueueRef.current.splice(0, eventQueueRef.current.length);
    const deltaEntries = Object.values(pendingDeltaRef.current);
    const now = Date.now();
    const shouldSendFullSnapshot = lastFullSyncAtRef.current === 0 || (now - lastFullSyncAtRef.current) >= 90_000;
    const payload: {
      exam_id: number;
      events: Array<{ event: string }>;
      warning_count: number;
      response?: { student_roll: string; responses: QuestionResponse[] };
      response_delta?: QuestionResponse[];
    } = {
      exam_id: exam.meta.exam_id,
      events: eventsToSend,
      warning_count: warningCountRef.current,
    };

    if (shouldSendFullSnapshot) {
      payload.response = buildSubmission();
    } else if (deltaEntries.length > 0) {
      payload.response_delta = deltaEntries;
    }

    heartbeatInFlightRef.current = true;

    setAutosaveState("saving");
    const res = await fetch(`${API}/response/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": token,
      },
      body: JSON.stringify(payload),
    }).catch(() => null);

    heartbeatInFlightRef.current = false;

    if (!res?.ok) {
      if (eventsToSend.length > 0) {
        eventQueueRef.current = [...eventsToSend, ...eventQueueRef.current];
      }
      setAutosaveState("error");
      return;
    }

    if (shouldSendFullSnapshot) {
      lastFullSyncAtRef.current = now;
      pendingDeltaRef.current = {};
    } else if (deltaEntries.length > 0) {
      for (const d of deltaEntries) {
        delete pendingDeltaRef.current[d.question_id];
      }
    }

    setAutosaveState("saved");
    setLastSavedAt(new Date().toLocaleTimeString());
  }, [token, submitted, submitting, exam.meta.exam_id, buildSubmission]);

  const submitExam = useCallback(async (reason: "manual" | "timeup" = "manual") => {
    if (!token || submittedRef.current || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError(null);
    setSubmitting(true);

    const res = await fetch(`${API}/response/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": token,
      },
      body: JSON.stringify({
        exam_id: exam.meta.exam_id,
        response: buildSubmission(),
      }),
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setSubmitError(body?.detail ?? "Could not submit. Please try again.");
      setSubmitting(false);
      submittingRef.current = false;
      return;
    }

    submittedRef.current = true;
    setSubmitted(true);
    setSubmitting(false);
    submittingRef.current = false;
    if (reason === "timeup") {
      toast.success("Time is up. Your exam has been submitted.");
    }
    router.push("/history");
  }, [token, exam.meta.exam_id, buildSubmission, router]);

  const clearOutOfFocusTermination = useCallback(() => {
    if (outOfFocusTimeoutRef.current) {
      clearTimeout(outOfFocusTimeoutRef.current);
      outOfFocusTimeoutRef.current = null;
    }
    if (outOfFocusIntervalRef.current) {
      clearInterval(outOfFocusIntervalRef.current);
      outOfFocusIntervalRef.current = null;
    }
    setOutOfFocusSecondsLeft(null);
  }, []);

  const armOutOfFocusTermination = useCallback(() => {
    if (submittedRef.current || submittingRef.current) return;
    if (!secureModeReachedRef.current) return;
    if (outOfFocusTimeoutRef.current) return;

    setOutOfFocusSecondsLeft(10);
    outOfFocusIntervalRef.current = setInterval(() => {
      setOutOfFocusSecondsLeft((v) => {
        if (v === null) return null;
        return Math.max(0, v - 1);
      });
    }, 1000);

    outOfFocusTimeoutRef.current = setTimeout(() => {
      eventQueueRef.current.push({ event: "auto_submitted_policy" });
      clearOutOfFocusTermination();
      void submitExam("manual");
    }, 10000);
  }, [clearOutOfFocusTermination, submitExam]);

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }

    void requestExamFullscreen();

    const warmup = setTimeout(() => {
      void sendHeartbeat();
    }, 1500);
    const id = setInterval(() => {
      void sendHeartbeat();
    }, 30000);

    return () => {
      clearTimeout(warmup);
      clearInterval(id);
    };
  }, [token, router, sendHeartbeat, requestExamFullscreen]);

  useEffect(() => {
    if (!token) return;

    const submitOnExit = () => {
      if (exitSubmitSentRef.current) return;
      if (submittedRef.current || submittingRef.current) return;

      exitSubmitSentRef.current = true;
      const payload = {
        exam_id: exam.meta.exam_id,
        response: {
          student_roll: studentRoll,
          responses: Object.values(responsesRef.current),
        },
      };

      // keepalive makes this best-effort request continue during page unload.
      void fetch(`${API}/response/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-token": token,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // Best-effort only; no UI updates possible during unload.
      });
    };

    const onBeforeUnload = () => submitOnExit();
    const onPageHide = (e: PageTransitionEvent) => {
      // Switching tabs can trigger pagehide in some browsers; skip submit for bfcache transitions.
      if (e.persisted) return;
      submitOnExit();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [token, exam.meta.exam_id, studentRoll]);

  useEffect(() => {
    if (submitted || submitting) {
      clearOutOfFocusTermination();
    }
  }, [submitted, submitting, clearOutOfFocusTermination]);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const id = setInterval(() => {
      setLockSeconds((v) => {
        if (v <= 1) {
          eventQueueRef.current.push({ event: "lock_ended" });
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [lockSeconds]);

  const emitViolation = useCallback((event: string, reason: string) => {
    if (submittedRef.current || submittingRef.current) return;
    const now = Date.now();

    // Global cooldown avoids duplicate warnings from one action (e.g. alt-tab firing blur + hidden).
    if (now - lastWarningAtRef.current < 2500) return;
    lastWarningAtRef.current = now;

    const prev = lastViolationAtRef.current[event] ?? 0;
    if (now - prev < 2000) return;
    lastViolationAtRef.current[event] = now;

    eventQueueRef.current.push({ event });
    eventQueueRef.current.push({ event: "warning_issued" });

    const nextWarnings = warningCountRef.current + 1;
    warningCountRef.current = nextWarnings;
    setWarningCount(nextWarnings);

    setLockReason(reason);
    setLockSeconds(10);
    eventQueueRef.current.push({ event: "lock_started" });

    void sendHeartbeat();

    if (nextWarnings >= maxWarnings) {
      eventQueueRef.current.push({ event: "auto_submitted_policy" });
      void submitExam("manual");
    }
  }, [maxWarnings, sendHeartbeat, submitExam]);

  useEffect(() => {
    if (!token) return;

    const isSecureNow = () => document.visibilityState === "visible" && document.hasFocus() && !!document.fullscreenElement;
    const onRecoveredFocus = () => {
      if (isSecureNow()) {
        secureModeReachedRef.current = true;
        clearOutOfFocusTermination();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        emitViolation("tab_hidden", "You switched tabs or minimized the exam window.");
        armOutOfFocusTermination();
      } else {
        onRecoveredFocus();
      }
    };
    const onBlur = () => {
      emitViolation("focus_lost", "Window focus was lost during the exam.");
      armOutOfFocusTermination();
    };
    const onFocus = () => onRecoveredFocus();
    const onFullscreen = () => {
      const inFullscreen = !!document.fullscreenElement;
      setIsFullscreen(inFullscreen);
      if (!inFullscreen) {
        emitViolation("fullscreen_exit", "You exited fullscreen mode.");
        setFullscreenError("Fullscreen is required for the exam.");
        armOutOfFocusTermination();
        void requestExamFullscreen();
      } else {
        setFullscreenError(null);
        onRecoveredFocus();
      }
    };
    const onKeydown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "c") {
        e.preventDefault();
        emitViolation("copy_attempt", "Copy is not allowed during exam.");
      }
      if ((e.ctrlKey || e.metaKey) && k === "v") {
        e.preventDefault();
        emitViolation("paste_attempt", "Paste is not allowed during exam.");
      }
      if (e.key === "PrintScreen") {
        emitViolation("screenshot_suspected", "Screenshot action detected.");
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      emitViolation("copy_attempt", "Copy is not allowed during exam.");
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      emitViolation("paste_attempt", "Paste is not allowed during exam.");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("keydown", onKeydown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKeydown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      clearOutOfFocusTermination();
    };
  }, [token, emitViolation, requestExamFullscreen, armOutOfFocusTermination, clearOutOfFocusTermination]);

  const setAnswer = (questionId: number, option: number | null) => {
    setResponses((prev) => {
      const curr = prev[questionId] ?? { question_id: questionId, option: null, marked: false };
      const next = { ...curr, option };
      pendingDeltaRef.current[questionId] = next;
      return { ...prev, [questionId]: next };
    });
  };

  const toggleMark = (questionId: number) => {
    setResponses((prev) => {
      const curr = prev[questionId] ?? { question_id: questionId, option: null, marked: false };
      const next = { ...curr, marked: !curr.marked };
      pendingDeltaRef.current[questionId] = next;
      return { ...prev, [questionId]: next };
    });
  };

  const onTimeUp = useCallback(() => {
    void submitExam("timeup");
  }, [submitExam]);

  const onBackClick = () => {
    if (submitting) return;
    setShowLeavePrompt(true);
  };

  const confirmLeaveAndSubmit = () => {
    if (submitting) return;
    setShowLeavePrompt(false);
    void submitExam("manual");
  };

  const confirmManualSubmit = () => {
    if (submitting) return;
    setShowSubmitPrompt(false);
    void submitExam("manual");
  };

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No questions found for this exam.
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 px-6 text-center">
        <div className="max-w-sm space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
          <h2 className="text-lg font-semibold text-zinc-100">Exam submitted</h2>
          <p className="text-sm text-zinc-400">Your responses were sent successfully.</p>
          <Link href="/history" className="inline-flex rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-yellow-300">
            Go to history
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {showLeavePrompt && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-zinc-950/85 px-6 text-center">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-semibold text-zinc-100">Leave exam?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Your current answers will be submitted and this attempt cannot be resumed.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowLeavePrompt(false)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500"
              >
                Continue exam
              </button>
              <button
                type="button"
                onClick={confirmLeaveAndSubmit}
                className="rounded-lg bg-yellow-400 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-yellow-300"
              >
                Submit and leave
              </button>
            </div>
          </div>
        </div>
      )}
      {showSubmitPrompt && (
        <div className="fixed inset-0 z-[56] flex items-center justify-center bg-zinc-950/85 px-6 text-center">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-semibold text-zinc-100">Submit exam now?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              You will not be able to edit answers after submission.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowSubmitPrompt(false)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmManualSubmit}
                className="rounded-lg bg-yellow-400 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-yellow-300"
              >
                Submit now
              </button>
            </div>
          </div>
        </div>
      )}
      {!isFullscreen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/95 px-6 text-center">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-yellow-400">Exam security</p>
            <h2 className="mt-2 text-lg font-semibold text-zinc-100">Fullscreen required</h2>
            <p className="mt-2 text-sm text-zinc-400">
              This exam can only continue in fullscreen mode.
            </p>
            <p className="mt-2 text-xs text-amber-300">Warnings {warningCount}/{maxWarnings}</p>
            {outOfFocusSecondsLeft !== null && (
              <p className="mt-1 text-xs text-red-400">Auto-submit in {outOfFocusSecondsLeft}s if focus is not restored.</p>
            )}
            {fullscreenError && <p className="mt-2 text-xs text-amber-400">{fullscreenError}</p>}
            <button
              type="button"
              onClick={() => {
                void requestExamFullscreen();
              }}
              className="mt-4 inline-flex rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-yellow-300"
            >
              Enter fullscreen
            </button>
          </div>
        </div>
      )}
      <PolicyOverlay lockSeconds={lockSeconds} reason={lockReason} warningCount={warningCount} maxWarnings={maxWarnings} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-5 py-3">
          <button
            type="button"
            onClick={onBackClick}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="h-5 w-px bg-zinc-800" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-zinc-100">{exam.meta.exam_name}</h1>
            <p className="text-xs text-zinc-500">{exam.meta.total_marks} marks</p>
          </div>
          <div className="hidden min-w-37.5 text-right text-[11px] text-zinc-500 sm:block">
            {autosaveState === "saving" && <span>Saving...</span>}
            {autosaveState === "saved" && <span>Saved {lastSavedAt ? `at ${lastSavedAt}` : ""}</span>}
            {autosaveState === "error" && <span className="text-amber-400">Autosave failed</span>}
            {autosaveState === "idle" && <span>Autosave idle</span>}
          </div>
          <button
            type="button"
            onClick={() => {
              if (submitting) return;
              setShowSubmitPrompt(true);
            }}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {submitting ? "Submitting..." : "Submit"}
          </button>
          <ExamTimer endTime={exam.meta.end_time} onTimeUp={onTimeUp} />
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section className="min-w-0 flex-1 overflow-y-auto p-6">
            <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
              <span>Q {activeIdx + 1} / {questions.length}</span>
              <span>ΓÇó</span>
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-800/60 bg-emerald-950/20 px-1.5 py-0.5 text-emerald-300">
                +{active.marks}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-red-800/60 bg-red-950/20 px-1.5 py-0.5 text-red-300">
                -{active.negative_marks}
              </span>
              <span>ΓÇó</span>
              <span>{answeredCount} answered</span>
              <span>ΓÇó</span>
              <span>{markedCount} marked</span>
              <span>ΓÇó</span>
              <span className="text-amber-400">Warnings {warningCount}/{maxWarnings}</span>
            </div>

            <QuestionView
              question={active}
              selected={activeResponse?.option ?? null}
              onChoose={(idx) => setAnswer(active.question_id, idx)}
            />

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAnswer(active.question_id, null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500"
              >
                <Eraser className="h-3.5 w-3.5" /> Clear
              </button>
              <button
                type="button"
                onClick={() => toggleMark(active.question_id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${activeResponse?.marked ? "border-amber-600/70 bg-amber-950/25 text-amber-300" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}
              >
                <Flag className="h-3.5 w-3.5" /> {activeResponse?.marked ? "Marked" : "Mark review"}
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveIdx((v) => Math.max(0, v - 1))}
                  disabled={activeIdx === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIdx((v) => Math.min(questions.length - 1, v + 1))}
                  disabled={activeIdx === questions.length - 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
              {submitError && (
                <p className="text-xs text-red-400">{submitError}</p>
              )}
            </div>
          </section>

          <QuestionPalette
            sections={exam.sections}
            activeId={active.question_id}
            responses={responses}
            onSelect={(questionId) => {
              const index = questions.findIndex((q) => q.question_id === questionId);
              if (index >= 0) setActiveIdx(index);
            }}
          />
        </div>
      </main>
    </div>
  );
}
