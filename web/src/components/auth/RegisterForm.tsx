"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Eye, EyeOff, Loader2, CheckCircle2, Mail } from "lucide-react";
import { API, APP_DESC, APP_NAME, APP_SHORT_NAME, LOGO, LOGO_ALT, ORG_DOMAIN, ORG_SHORT_NAME } from "@/lib/config";

// ── Schema ────────────────────────────────────────────────────────────────────

const schema = z
  .object({
    role: z.enum(["Student", "Faculty"]),
    name: z.string().optional().default(""),
    email: z.string().email("Enter a valid email address"),
    roll: z.string().optional().default(""),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
    }
    if (data.role === "Student") {
      const email = data.email.trim().toLowerCase();
      const suffix = `@${ORG_DOMAIN}`;
      if (!email.endsWith(suffix) || email.indexOf("@") <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Students must use college email in the format roll@${ORG_DOMAIN}`,
          path: ["email"],
        });
      }
      return;
    }

    if ((data.name ?? "").trim().length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Name must be at least 2 characters",
        path: ["name"],
      });
    }
    if (!(data.roll ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This field is required",
        path: ["roll"],
      });
    }
  });

type FormData = z.infer<typeof schema>;
type Role = "Student" | "Faculty";
type StudentPreview = {
  Name: string;
  Roll: string;
  Pic: string;
  Branch: string;
};

// ── Sub-components ────────────────────────────────────────────────────────────

function AppLogo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO} alt={LOGO_ALT} width={120} height={120} style={{ objectFit: "contain" }} />;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-400 mt-1">{message}</p>;
}

function InputField({
  id, label, type = "text", placeholder, disabled, error,
  hint, registration, rightSlot,
}: {
  id: string; label: string; type?: string; placeholder?: string;
  disabled?: boolean; error?: string; hint?: string;
  registration: object; rightSlot?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-300">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            w-full rounded-lg border bg-zinc-900 px-3.5 py-2.5
            text-sm text-zinc-100 placeholder:text-zinc-600
            transition-colors outline-none
            focus:ring-2 focus:ring-yellow-500/70 focus:border-yellow-500
            disabled:opacity-50
            ${rightSlot ? "pr-10" : ""}
            ${error
              ? "border-red-800 focus:ring-red-700/50 focus:border-red-700"
              : "border-zinc-800 hover:border-zinc-700"
            }
          `}
          {...registration}
        />
        {rightSlot && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</div>
        )}
      </div>
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

function PasswordField({
  id, label, placeholder, disabled, error, registration,
}: {
  id: string; label: string; placeholder?: string;
  disabled?: boolean; error?: string; registration: object;
}) {
  const [show, setShow] = useState(false);
  return (
    <InputField
      id={id} label={label}
      type={show ? "text" : "password"}
      placeholder={placeholder ?? "••••••••"}
      disabled={disabled} error={error}
      registration={registration}
      rightSlot={
        <button
          type="button" tabIndex={-1}
          onClick={() => setShow((v) => !v)}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      }
    />
  );
}

// ── Success state ─────────────────────────────────────────────────────────────

function SuccessState({ email, message }: { email: string; message?: string }) {
  const displayMessage = message?.trim() || "We sent a verification link to your email.";
  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="flex items-center gap-2.5 text-yellow-400 lg:hidden">
        <AppLogo />
        <span className="text-3xl font-semibold text-zinc-100">{APP_SHORT_NAME}</span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 space-y-5 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-yellow-950/40 p-3 border border-yellow-800/40">
            <Mail className="w-6 h-6 text-yellow-400" />
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-zinc-100">Check your email</h2>
          <p className="text-sm text-zinc-500 leading-relaxed">
            <span className="text-zinc-300 font-medium">{email}</span>
            <br />
            {displayMessage}
          </p>
        </div>
        <p className="text-xs text-zinc-500">Didn&apos;t receive it? Check your spam folder.</p>
      </div>

      <p className="text-sm text-zinc-500 text-center">
        <Link href="/login" className="text-yellow-400 hover:text-yellow-300 font-medium transition-colors">
          ← Back to sign in
        </Link>
      </p>

      <div className="lg:hidden space-y-1 text-zinc-500 text-xs text-center">
        <p>© {new Date().getFullYear()} {ORG_SHORT_NAME}. All rights reserved.</p>
        <p>Design and Developed By S. Avinash and Abhinay Kumar</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const FEATURES = [
  "Attend exams from any device",
  "Instant results and score breakdown",
  "Track your performance over time",
];

export default function RegisterForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [submittedMessage, setSubmittedMessage] = useState("");
  const [studentPreview, setStudentPreview] = useState<StudentPreview | null>(null);
  const [pendingData, setPendingData] = useState<FormData | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: "Student" },
  });

  const role = watch("role") as Role;
  const email = watch("email") ?? "";

  useEffect(() => {
    setStudentPreview(null);
    setPendingData(null);
  }, [email, role]);

  const submitRegistration = async (data: FormData) => {
    let res: Response;
    try {
      res = await fetch(`${API}/user/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.role === "Faculty" ? (data.name ?? "") : "",
          email: data.email,
          password: data.password,
          roll: data.role === "Faculty" ? (data.roll ?? "") : "",
          role: data.role,
        }),
      });
    } catch {
      setServerError("Could not reach the server.");
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setServerError(err.detail ?? "Registration failed. Please try again.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    const msg = typeof body?.msg === "string" ? body.msg : "";

    if (msg.toLowerCase().includes("already sent recently")) {
      setServerError(msg);
      return;
    }

    setSubmittedEmail(data.email);
    setSubmittedMessage(msg || "Check your inbox for your verification link. The link expires in 10 minutes.");
    setSubmitted(true);
  };

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    if (data.role === "Faculty") {
      await submitRegistration(data);
      return;
    }

    const previewRes = await fetch(`${API}/user/student-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: data.email }),
    }).catch(() => null);

    if (!previewRes) {
      setServerError("Could not reach the server.");
      return;
    }

    if (!previewRes.ok) {
      const err = await previewRes.json().catch(() => ({}));
      setServerError(err.detail ?? "please enter correct roll number");
      setStudentPreview(null);
      setPendingData(null);
      return;
    }

    const payload = await previewRes.json().catch(() => ({}));
    const student = (payload.student ?? null) as StudentPreview | null;
    if (!student) {
      setServerError("please enter correct roll number");
      return;
    }
    setStudentPreview(student);
    setPendingData(data);
  };

  return (
    <div className="flex min-h-screen bg-[#09090b]">

      {/* ── Left brand panel ─────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[42%] flex-col justify-between p-12 relative overflow-hidden border-r border-zinc-800"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 80% 60% at 30% 40%, rgba(234,179,8,0.07) 0%, transparent 70%),
            radial-gradient(circle, #27272a 1px, transparent 1px)
          `,
          backgroundSize: "100% 100%, 28px 28px",
          backgroundColor: "#0d0d0d",
        }}
      >
        <div className="flex items-center gap-3 text-yellow-400">
          <AppLogo />
          <div>
            <strong>
              <span className="translate-y-2 text-5xl font-sans tracking-tight text-yellow-400">
                {APP_NAME}
              </span>
            </strong>
            <p className="mt-1 text-2xl text-zinc-400">{APP_DESC}</p>
          </div>
        </div>

        <div className="space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-bold text-zinc-100 leading-snug">
              Your exams.
              <br />
              Your results.
              <br />
              <span className="text-yellow-400">Your journey.</span>
            </h2>
            <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
              Create your {APP_SHORT_NAME} account and get started in minutes.
            </p>
          </div>
          <ul className="space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-300">
                <CheckCircle2 className="w-4 h-4 text-yellow-500 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-1 text-zinc-500 text-xs">
          <p>© {new Date().getFullYear()} {ORG_SHORT_NAME}. All rights reserved.</p>
          <p>Design and Developed By S. Avinash and Abhinay Kumar</p>
        </div>
      </div>

      {/* ── Right form panel ──────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">

        {submitted ? (
          <SuccessState email={submittedEmail} message={submittedMessage} />
        ) : (
          <div className="w-full max-w-sm space-y-7">

            <div className="flex items-center gap-2.5 text-yellow-400 lg:hidden">
              <AppLogo />
              <span className="text-3xl font-semibold text-zinc-100">{APP_SHORT_NAME}</span>
            </div>

            {/* Card underlay */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-7 py-8 space-y-7">

            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold text-zinc-100">Create an account</h1>
              <p className="text-sm text-zinc-400">
                Already have one?{" "}
                <Link href="/login" className="text-yellow-400 hover:text-yellow-300 font-medium transition-colors">
                  Sign in
                </Link>
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

              {serverError && (
                <div className="rounded-lg bg-red-950/50 border border-red-900/60 px-3.5 py-3 text-sm text-red-400">
                  {serverError}
                </div>
              )}

              {studentPreview && pendingData && (
                <div className="rounded-lg border border-sky-800/60 bg-sky-950/30 p-3.5 space-y-3">
                  <p className="text-xs uppercase tracking-wider text-sky-300">Student Verification</p>
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={studentPreview.Pic}
                      alt={studentPreview.Name}
                      className="h-16 w-16 rounded-md object-cover border border-zinc-700"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 truncate">{studentPreview.Name}</p>
                      <p className="text-xs text-zinc-300">Roll: {studentPreview.Roll}</p>
                      <p className="text-xs text-zinc-400">Branch: {studentPreview.Branch}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setStudentPreview(null);
                        setPendingData(null);
                        void submitRegistration(pendingData);
                      }}
                      className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-emerald-400 transition-colors"
                    >
                      Yes This is me
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStudentPreview(null);
                        setPendingData(null);
                        setServerError("please enter correct roll number");
                      }}
                      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 transition-colors"
                    >
                      No
                    </button>
                  </div>
                </div>
              )}

              <InputField
                id="email" label="Email address"
                type="email"
                placeholder={role === "Student" ? `roll@${ORG_DOMAIN}` : `you@${ORG_DOMAIN}`}
                hint={role === "Student"
                  ? `Students must use college email (roll@${ORG_DOMAIN})`
                  : "Your institutional or personal email"}
                disabled={isSubmitting || !!studentPreview}
                error={errors.email?.message}
                registration={register("email")}
              />

              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-zinc-300">I am a</span>
                <div className="grid grid-cols-2 gap-2">
                  {(["Student", "Faculty"] as Role[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setValue("role", r, { shouldValidate: true, shouldDirty: true, shouldTouch: true })}
                      disabled={!!studentPreview}
                      className={`
                        relative flex items-center justify-center gap-2 rounded-lg border py-2.5 px-4
                        text-sm font-medium transition-all disabled:opacity-60
                        ${role === r
                          ? "border-yellow-500/70 bg-yellow-500/10 text-yellow-300 shadow-[0_0_0_1px_rgba(234,179,8,0.25)]"
                          : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                        }
                      `}
                    >
                      {role === r && (
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                      )}
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {role === "Faculty" && (
                <>
                  <InputField
                    id="name" label="Full name"
                    placeholder="Your full name"
                    disabled={isSubmitting || !!studentPreview}
                    error={errors.name?.message}
                    registration={register("name")}
                  />

                  <InputField
                    id="roll"
                    label="Employee ID"
                    placeholder="e.g. FAC2024"
                    disabled={isSubmitting || !!studentPreview}
                    error={errors.roll?.message}
                    registration={register("roll")}
                  />
                </>
              )}

              <PasswordField
                id="password" label="Password"
                disabled={isSubmitting || !!studentPreview}
                error={errors.password?.message}
                registration={register("password")}
              />

              <PasswordField
                id="confirmPassword" label="Confirm password"
                disabled={isSubmitting || !!studentPreview}
                error={errors.confirmPassword?.message}
                registration={register("confirmPassword")}
              />

              <button
                type="submit"
                disabled={isSubmitting || !!studentPreview}
                className="
                  w-full flex items-center justify-center gap-2 mt-2
                  rounded-lg bg-yellow-400 hover:bg-yellow-300
                  px-4 py-2.5 text-sm font-medium text-zinc-900
                  transition-colors disabled:opacity-60 disabled:cursor-not-allowed
                  focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-[#09090b]
                "
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSubmitting ? "Creating account…" : "Create account"}
              </button>
            </form>
            </div>{/* end card */}

            <div className="lg:hidden space-y-1 text-zinc-500 text-xs text-center">
              <p>© {new Date().getFullYear()} {ORG_SHORT_NAME}. All rights reserved.</p>
              <p>Design and Developed By S. Avinash and Abhinay Kumar</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
