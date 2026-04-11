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
import { API, HEARTBEAT_INTERVAL_MS } from "@/lib/config";

type BlindModeState = "idle" | "speaking" | "listening" | "processing";

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: Event & { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtorLike = new () => SpeechRecognitionLike;

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];
const VOICE_COMMANDS = [
  "A, B, C, D, E, F: select option",
  "Next: go to next question",
  "Previous / Back: go to previous question",
  "Mark / Review: toggle mark for review",
  "Repeat: read current question again",
  "Clear: remove selected option",
  "Unanswered / Skipped: jump to next unanswered",
  "Submit: open submit confirmation",
  "Confirm / Yes: confirm submit prompt",
  "Cancel / No: close prompt",
];

type TranscriptEntry = {
  id: string;
  speaker: "you" | "assistant" | "system";
  text: string;
  at: string;
};

function hasImageContent(question: ExamStructure["sections"][number]["questions"][number]): boolean {
  if (typeof question.image_url === "string" && question.image_url.trim()) {
    return true;
  }
  return question.options.some((opt) => (
    typeof opt !== "string" && typeof opt.image_url === "string" && opt.image_url.trim().length > 0
  ));
}

function parseBlindCommand(input: string): string | null {
  const text = input.trim().toLowerCase();

  const optionMap: Record<string, string> = {
    a: "OPTION_A", "option a": "OPTION_A", "letter a": "OPTION_A", ay: "OPTION_A",
    b: "OPTION_B", "option b": "OPTION_B", "letter b": "OPTION_B", bee: "OPTION_B", be: "OPTION_B",
    c: "OPTION_C", "option c": "OPTION_C", "letter c": "OPTION_C", see: "OPTION_C",
    d: "OPTION_D", "option d": "OPTION_D", "letter d": "OPTION_D", dee: "OPTION_D",
    e: "OPTION_E", "option e": "OPTION_E", "letter e": "OPTION_E",
    f: "OPTION_F", "option f": "OPTION_F", "letter f": "OPTION_F",
  };
  if (optionMap[text]) return optionMap[text];

  if (text.includes("next")) return "NEXT";
  if (text.includes("previous") || text.includes("prev") || text.includes("back")) return "PREV";
  if (text.includes("mark") || text.includes("review")) return "MARK";
  if (text.includes("repeat") || text.includes("again")) return "REPEAT";
  if (text.includes("clear") || text.includes("remove")) return "CLEAR";
  if (text.includes("submit") || text.includes("finish")) return "SUBMIT";
  if (text.includes("unanswered") || text.includes("skipped")) return "UNANSWERED";
  if (text.includes("cancel") || text.includes("no")) return "CANCEL";
  if (text.includes("yes") || text.includes("confirm")) return "CONFIRM";
  return null;
}

export default function ExamRunner({ exam }: { exam: ExamStructure }) {
  const router = useRouter();
  const allQuestions = useMemo(() => exam.sections.flatMap((s) => s.questions), [exam.sections]);
  const questions = useMemo(() => allQuestions.filter((q) => !hasImageContent(q)), [allQuestions]);
  const hiddenQuestionCount = allQuestions.length - questions.length;
  const blindTotalMarks = useMemo(
    () => questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0),
    [questions],
  );
  const gradingScopeQuestionIds = useMemo(
    () => questions.map((q) => q.question_id),
    [questions],
  );

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
  const [blindModeEnabled, setBlindModeEnabled] = useState(true);
  const [blindModeState, setBlindModeState] = useState<BlindModeState>("idle");
  const [showListeningBadge, setShowListeningBadge] = useState(false);
  const [preferredVoice, setPreferredVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    {
      id: "init",
      speaker: "system",
      text: "Blind transcript is ready. Enable blind mode to begin voice interaction.",
      at: new Date().toLocaleTimeString(),
    },
  ]);
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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const blindModeStateRef = useRef<BlindModeState>("idle");
  const blindSubmitConfirmRef = useRef(false);
  const submitExamRef = useRef<(reason: "manual" | "timeup") => void>(() => {});
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const blindInitLoggedRef = useRef(false);

  const maxWarnings = Math.max(1, Number((exam.meta as ExamStructure["meta"] & { max_warnings?: number }).max_warnings ?? 3));
  const uiLockedByBlind = blindModeEnabled;

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

  const selectedVoice = useMemo(() => {
    if (!selectedVoiceURI) return preferredVoice;
    return availableVoices.find((v) => v.voiceURI === selectedVoiceURI) ?? preferredVoice;
  }, [availableVoices, selectedVoiceURI, preferredVoice]);

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
    blindModeStateRef.current = blindModeState;
  }, [blindModeState]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const pickBestVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      setAvailableVoices(voices);

      const remote = voices.filter((v) => !v.localService);
      const remoteEnglish = remote.filter((v) => v.lang.toLowerCase().startsWith("en"));
      const localEnglish = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith("en"));

      const qualityPattern = /(natural|neural|online|google|aria|jenny|guy|zira|hazel|ravi|heera)/i;
      const best =
        remoteEnglish.find((v) => qualityPattern.test(v.name)) ??
        remoteEnglish[0] ??
        remote.find((v) => qualityPattern.test(v.name)) ??
        remote[0] ??
        localEnglish.find((v) => qualityPattern.test(v.name)) ??
        localEnglish[0] ??
        voices[0] ??
        null;

      setPreferredVoice(best);
      setSelectedVoiceURI((prev) => {
        if (prev && voices.some((v) => v.voiceURI === prev)) return prev;
        return best?.voiceURI ?? voices[0]?.voiceURI ?? null;
      });
    };

    pickBestVoice();
    window.speechSynthesis.addEventListener("voiceschanged", pickBestVoice);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", pickBestVoice);
    };
  }, []);

  useEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [transcript]);

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

  const appendTranscript = useCallback((speaker: TranscriptEntry["speaker"], text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setTranscript((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          speaker,
          text: trimmed,
          at: new Date().toLocaleTimeString(),
        },
      ];
      return next.slice(-80);
    });
  }, []);

  useEffect(() => {
    if (!blindModeEnabled || blindInitLoggedRef.current) return;
    blindInitLoggedRef.current = true;
    eventQueueRef.current.push({ event: "blind_mode_enabled" });
    appendTranscript("system", "Blind mode enabled.");
  }, [blindModeEnabled, appendTranscript]);

  const speakBlindText = useCallback((text: string) => {
    appendTranscript("assistant", text);
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setBlindModeState("speaking");
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.98;
    utter.pitch = 1;
    utter.lang = selectedVoice?.lang ?? "en-US";
    if (selectedVoice) {
      utter.voice = selectedVoice;
    }
    utter.onend = () => {
      setBlindModeState("idle");
    };
    utter.onerror = () => {
      setBlindModeState("idle");
    };
    window.speechSynthesis.speak(utter);
  }, [appendTranscript, selectedVoice]);

  const setAnswer = useCallback((questionId: number, option: number | null) => {
    setResponses((prev) => {
      const curr = prev[questionId] ?? { question_id: questionId, option: null, marked: false };
      const next = { ...curr, option };
      pendingDeltaRef.current[questionId] = next;
      return { ...prev, [questionId]: next };
    });
  }, []);

  const toggleMark = useCallback((questionId: number) => {
    setResponses((prev) => {
      const curr = prev[questionId] ?? { question_id: questionId, option: null, marked: false };
      const next = { ...curr, marked: !curr.marked };
      pendingDeltaRef.current[questionId] = next;
      return { ...prev, [questionId]: next };
    });
  }, []);

  const speakQuestion = useCallback((questionIndex: number) => {
    const q = questions[questionIndex];
    if (!q) return;
    const parts: string[] = [
      `Question ${questionIndex + 1}. ${q.text}`,
    ];
    q.options.forEach((opt, i) => {
      const letter = OPTION_LETTERS[i] ?? `${i + 1}`;
      const txt = typeof opt === "string" ? opt : opt.text || "Image option";
      parts.push(`Option ${letter}. ${txt}`);
    });
    speakBlindText(parts.join(". "));
  }, [questions, speakBlindText]);

  const stopBlindListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setShowListeningBadge(false);
    setBlindModeState("idle");
  }, []);

  const startBlindListening = useCallback(() => {
    if (!blindModeEnabled) return;
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtorLike;
      webkitSpeechRecognition?: SpeechRecognitionCtorLike;
    };
    const SpeechRecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      speakBlindText("Voice recognition is not supported in this browser.");
      return;
    }

    setBlindModeState("listening");
    setShowListeningBadge(true);
    appendTranscript("system", "Listening...");
    const rec: SpeechRecognitionLike = new SpeechRecognitionCtor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      appendTranscript("you", text || "(no speech captured)");
      setBlindModeState("processing");
      setShowListeningBadge(false);
      const cmd = parseBlindCommand(text);
      if (!active) {
        setBlindModeState("idle");
        return;
      }
      if (!cmd) {
        speakBlindText("Say A, B, C, D, Next, Back, Mark, Clear, Repeat or Submit.");
        return;
      }

      if (cmd.startsWith("OPTION_")) {
        const letter = cmd.split("_")[1];
        const idx = OPTION_LETTERS.indexOf(letter);
        if (idx < 0 || idx >= (active?.options.length ?? 0)) {
          speakBlindText("Invalid option for this question.");
          return;
        }
        if (responses[active.question_id]?.option === idx) {
          speakBlindText(`Option ${letter} already selected.`);
          return;
        }
        setAnswer(active.question_id, idx);
        speakBlindText(`Selected option ${letter}.`);
        return;
      }

      if (cmd === "NEXT") {
        if (activeIdx < questions.length - 1) {
          setActiveIdx((v) => Math.min(questions.length - 1, v + 1));
          setTimeout(() => speakQuestion(Math.min(questions.length - 1, activeIdx + 1)), 700);
        } else {
          speakBlindText("You are on the last question. Say submit to submit exam.");
        }
        return;
      }

      if (cmd === "PREV") {
        if (activeIdx > 0) {
          setActiveIdx((v) => Math.max(0, v - 1));
          setTimeout(() => speakQuestion(Math.max(0, activeIdx - 1)), 700);
        } else {
          speakBlindText("You are on the first question.");
        }
        return;
      }

      if (cmd === "MARK") {
        const before = responses[active.question_id];
        const wasMarked = !!before?.marked;
        toggleMark(active.question_id);
        speakBlindText(wasMarked ? "Review mark removed." : "Marked question for review.");
        return;
      }

      if (cmd === "REPEAT") {
        speakQuestion(activeIdx);
        return;
      }

      if (cmd === "CLEAR") {
        if (responses[active.question_id]?.option === null || responses[active.question_id]?.option === undefined) {
          speakBlindText("No answer selected for this question.");
        } else {
          setAnswer(active.question_id, null);
          speakBlindText("Answer cleared.");
        }
        return;
      }

      if (cmd === "UNANSWERED") {
        const nextUnanswered = questions.findIndex((q) => {
          const r = responses[q.question_id];
          return !r || r.option === null;
        });
        if (nextUnanswered < 0) {
          speakBlindText("All questions are answered.");
        } else {
          setActiveIdx(nextUnanswered);
          setTimeout(() => speakQuestion(nextUnanswered), 700);
        }
        return;
      }

      if (cmd === "SUBMIT") {
        if (!blindSubmitConfirmRef.current) {
          blindSubmitConfirmRef.current = true;
          speakBlindText("Say submit again to confirm, or say cancel.");
          setTimeout(() => {
            blindSubmitConfirmRef.current = false;
          }, 8000);
          return;
        }
        blindSubmitConfirmRef.current = false;
        setShowSubmitPrompt(true);
        speakBlindText("Submit confirmation opened.");
        return;
      }

      if (cmd === "CANCEL") {
        blindSubmitConfirmRef.current = false;
        setShowSubmitPrompt(false);
        setShowLeavePrompt(false);
        speakBlindText("Cancelled.");
        return;
      }

      if (cmd === "CONFIRM" && showSubmitPrompt) {
        setShowSubmitPrompt(false);
        submitExamRef.current("manual");
      }
    };
    rec.onerror = () => {
      setBlindModeState("idle");
      setShowListeningBadge(false);
      appendTranscript("system", "Speech recognition error. Please try again.");
      speakBlindText("Could not understand. Press space and try again.");
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setShowListeningBadge(false);
      if (blindModeStateRef.current === "listening") {
        setBlindModeState("idle");
      }
    };
    recognitionRef.current = rec;
    rec.start();
  }, [blindModeEnabled, speakBlindText, active, activeIdx, questions, responses, showSubmitPrompt, setAnswer, toggleMark, speakQuestion, appendTranscript]);

  const toggleBlindMode = useCallback(() => {
    const next = !blindModeEnabled;
    setBlindModeEnabled(next);
    if (next) {
      eventQueueRef.current.push({ event: "blind_mode_enabled" });
      appendTranscript("system", "Blind mode enabled.");
      speakBlindText(
        "Blind mode activated. Press space bar to give voice commands. You can say A, B, C, D, Mark, Next, Back, Repeat, Clear, or Submit."
      );
    } else {
      eventQueueRef.current.push({ event: "blind_mode_disabled" });
      appendTranscript("system", "Blind mode disabled.");
      stopBlindListening();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      setBlindModeState("idle");
    }
  }, [blindModeEnabled, speakBlindText, stopBlindListening, appendTranscript]);

  useEffect(() => {
    if (!uiLockedByBlind) return;
    const activeEl = document.activeElement as HTMLElement | null;
    activeEl?.blur();
  }, [uiLockedByBlind]);

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
      grading_scope_question_ids: gradingScopeQuestionIds,
    };
  }, [responses, studentRoll, gradingScopeQuestionIds]);

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

    if (!shouldSendFullSnapshot && eventsToSend.length === 0 && deltaEntries.length === 0) {
      return;
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

  useEffect(() => {
    submitExamRef.current = (reason: "manual" | "timeup") => {
      void submitExam(reason);
    };
  }, [submitExam]);

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
    }, HEARTBEAT_INTERVAL_MS);

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
      if (blindModeEnabled && (e.key === " " || e.key === "Enter" || e.key === "Tab")) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (blindModeEnabled && e.key === " ") {
        e.preventDefault();
        if (blindModeStateRef.current === "speaking") {
          if (typeof window !== "undefined" && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
          }
          setBlindModeState("idle");
          setTimeout(() => startBlindListening(), 120);
          return;
        }
        if (blindModeStateRef.current === "listening") {
          stopBlindListening();
          return;
        }
        if (blindModeStateRef.current === "idle") {
          startBlindListening();
          return;
        }
      }

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
    const onKeyup = (e: KeyboardEvent) => {
      if (blindModeEnabled && (e.key === " " || e.key === "Enter" || e.key === "Tab")) {
        e.preventDefault();
        e.stopPropagation();
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
    window.addEventListener("keydown", onKeydown, true);
    window.addEventListener("keyup", onKeyup, true);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("keyup", onKeyup, true);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      clearOutOfFocusTermination();
    };
  }, [token, emitViolation, requestExamFullscreen, armOutOfFocusTermination, clearOutOfFocusTermination, blindModeEnabled, startBlindListening, stopBlindListening]);

  useEffect(() => {
    return () => {
      stopBlindListening();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [stopBlindListening]);

  const onTimeUp = useCallback(() => {
    void submitExam("timeup");
  }, [submitExam]);

  const onBackClick = () => {
    if (submitting) return;
    setShowLeavePrompt(true);
  };

  const onSubmitClick = () => {
    if (submitting) return;
    setShowSubmitPrompt(true);
  };

  const confirmLeaveAndSubmit = () => {
    if (submitting) return;
    setShowLeavePrompt(false);
    void submitExam("manual");
  };

  if (!active) {
    if (questions.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div className="max-w-lg space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-semibold text-zinc-100">Blind mode unavailable for this paper</h2>
            <p className="text-sm text-zinc-400">
              All questions in this exam contain image content, so there are no blind-mode compatible questions to attempt.
            </p>
            <Link href="/student" className="inline-flex rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-yellow-300">
              Back to dashboard
            </Link>
          </div>
        </div>
      );
    }
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
        <div className="fixed inset-0 z-55 flex items-center justify-center bg-zinc-950/85 px-6 text-center">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-semibold text-zinc-100">Leave exam?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Your current answers will be submitted and this attempt cannot be resumed.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowLeavePrompt(false)}
                disabled={uiLockedByBlind}
                tabIndex={uiLockedByBlind ? -1 : 0}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500"
              >
                Continue exam
              </button>
              <button
                type="button"
                onClick={confirmLeaveAndSubmit}
                disabled={uiLockedByBlind}
                tabIndex={uiLockedByBlind ? -1 : 0}
                className="rounded-lg bg-yellow-400 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-yellow-300"
              >
                Submit and leave
              </button>
            </div>
          </div>
        </div>
      )}
      {showSubmitPrompt && (
        <div className="fixed inset-0 z-56 flex items-center justify-center bg-zinc-950/85 px-6 text-center">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-lg font-semibold text-zinc-100">Submit exam?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              You cannot edit answers after submission.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowSubmitPrompt(false)}
                disabled={uiLockedByBlind}
                tabIndex={uiLockedByBlind ? -1 : 0}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500"
              >
                Continue exam
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSubmitPrompt(false);
                  void submitExam("manual");
                }}
                disabled={uiLockedByBlind}
                tabIndex={uiLockedByBlind ? -1 : 0}
                className="rounded-lg bg-yellow-400 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-yellow-300"
              >
                Submit now
              </button>
            </div>
          </div>
        </div>
      )}
      {!isFullscreen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-zinc-950/95 px-6 text-center">
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
        <header className="flex flex-wrap items-center gap-2 sm:gap-3 border-b border-zinc-800 bg-zinc-900/60 px-3 py-3 sm:px-5">
          <button
            type="button"
            onClick={onBackClick}
            disabled={submitting || uiLockedByBlind}
            tabIndex={uiLockedByBlind ? -1 : 0}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="hidden h-5 w-px bg-zinc-800 sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-zinc-100">{exam.meta.exam_name}</h1>
            <p className="text-xs text-zinc-500">
              {blindTotalMarks} marks
              {hiddenQuestionCount > 0 ? ` (${hiddenQuestionCount} image question${hiddenQuestionCount === 1 ? "" : "s"} excluded in blind mode)` : ""}
            </p>
          </div>
          <div className="hidden min-w-37.5 text-right text-[11px] text-zinc-500 lg:block">
            {autosaveState === "saving" && <span>Saving...</span>}
            {autosaveState === "saved" && <span>Saved {lastSavedAt ? `at ${lastSavedAt}` : ""}</span>}
            {autosaveState === "error" && <span className="text-amber-400">Autosave failed</span>}
            {autosaveState === "idle" && <span>Autosave idle</span>}
          </div>
          <button
            type="button"
            onClick={toggleBlindMode}
            className={`inline-flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${blindModeEnabled ? "border-sky-700/70 bg-sky-950/30 text-sky-300" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}
          >
            {blindModeEnabled ? "Blind: ON" : "Enable blind"}
          </button>
          {showListeningBadge && (
            <span className="hidden text-[11px] text-red-300 sm:inline">Listening...</span>
          )}
          <button
            type="button"
            onClick={onSubmitClick}
            disabled={submitting || uiLockedByBlind}
            tabIndex={uiLockedByBlind ? -1 : 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {submitting ? "Submitting..." : "Submit"}
          </button>
          <ExamTimer endTime={exam.meta.end_time} onTimeUp={onTimeUp} />
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>Q {activeIdx + 1} / {questions.length}</span>
              <span>•</span>
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-800/60 bg-emerald-950/20 px-1.5 py-0.5 text-emerald-300">
                +{active.marks}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-red-800/60 bg-red-950/20 px-1.5 py-0.5 text-red-300">
                -{active.negative_marks}
              </span>
              <span>•</span>
              <span>{answeredCount} answered</span>
              <span>•</span>
              <span>{markedCount} marked</span>
              <span>•</span>
              <span className="text-amber-400">Warnings {warningCount}/{maxWarnings}</span>
            </div>

            <QuestionView
              question={active}
              selected={activeResponse?.option ?? null}
              onChoose={(idx) => setAnswer(active.question_id, idx)}
              disabled={uiLockedByBlind}
            />

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAnswer(active.question_id, null)}
                disabled={uiLockedByBlind}
                tabIndex={uiLockedByBlind ? -1 : 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500"
              >
                <Eraser className="h-3.5 w-3.5" /> Clear
              </button>
              <button
                type="button"
                onClick={() => toggleMark(active.question_id)}
                disabled={uiLockedByBlind}
                tabIndex={uiLockedByBlind ? -1 : 0}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${activeResponse?.marked ? "border-amber-600/70 bg-amber-950/25 text-amber-300" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}
              >
                <Flag className="h-3.5 w-3.5" /> {activeResponse?.marked ? "Marked" : "Mark review"}
              </button>
              <div className="ml-0 flex w-full items-center justify-end gap-2 sm:ml-auto sm:w-auto">
                <button
                  type="button"
                  onClick={() => setActiveIdx((v) => Math.max(0, v - 1))}
                  disabled={activeIdx === 0 || uiLockedByBlind}
                  tabIndex={uiLockedByBlind ? -1 : 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIdx((v) => Math.min(questions.length - 1, v + 1))}
                  disabled={activeIdx === questions.length - 1 || uiLockedByBlind}
                  tabIndex={uiLockedByBlind ? -1 : 0}
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

            <div className="mt-6 grid gap-4 xl:grid-cols-3">
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Transcript</p>
                  <span className="text-[11px] text-zinc-500">{blindModeState}</span>
                </div>
                <div ref={transcriptRef} className="h-52 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  {transcript.map((line) => (
                    <div key={line.id} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                        {line.speaker} <span className="ml-1 normal-case tracking-normal">{line.at}</span>
                      </p>
                      <p className="mt-1 text-xs text-zinc-200">{line.text}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Voice commands</p>
                <div className="h-52 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <ul className="space-y-2 text-xs text-zinc-300">
                    {VOICE_COMMANDS.map((cmd) => (
                      <li key={cmd} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
                        {cmd}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Voice selection</p>
                <div className="space-y-3">
                  <label className="block text-[11px] text-zinc-500" htmlFor="blind-voice-selector">Available voices</label>
                  <select
                    id="blind-voice-selector"
                    value={selectedVoiceURI ?? ""}
                    onChange={(e) => setSelectedVoiceURI(e.target.value || null)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-yellow-500"
                  >
                    {availableVoices.map((voice, index) => (
                      <option key={`${voice.voiceURI}-${voice.name}-${voice.lang}-${index}`} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => speakBlindText("This is a voice test sample for blind mode.")}
                    className="inline-flex items-center rounded-md border border-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:border-zinc-500"
                  >
                    Test voice
                  </button>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
                    <p><span className="text-zinc-500">Type:</span> {selectedVoice?.localService ? "Offline (local)" : "Online (remote)"}</p>
                    <p><span className="text-zinc-500">Name:</span> {selectedVoice?.name ?? "-"}</p>
                    <p><span className="text-zinc-500">Language:</span> {selectedVoice?.lang ?? "-"}</p>
                    <p><span className="text-zinc-500">Default:</span> {selectedVoice?.default ? "Yes" : "No"}</p>
                    <p className="break-all"><span className="text-zinc-500">URI:</span> {selectedVoice?.voiceURI ?? "-"}</p>
                  </div>
                </div>
              </section>
            </div>
          </section>

          <QuestionPalette
            sections={exam.sections}
            activeId={active.question_id}
            responses={responses}
            disabled={uiLockedByBlind}
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
