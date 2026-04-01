"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { setCookie } from "cookies-next";
import { API, APP_NAME, LOGO } from "@/lib/config";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormData = z.infer<typeof schema>;

function WaffleLogo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO} alt="SMEC logo" width={120} height={120} style={{ objectFit: "contain" }} />;
}

const FEATURES = [
  "Secure, proctored examinations",
  "Live exam monitoring for faculty",
  "Detailed performance analytics",
];

export default function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("expired") === "1") {
      setSessionExpired(true);
    }
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setServerError(null);

    let loginRes: Response;
    try {
      loginRes = await fetch(`${API}/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
    } catch {
      setServerError("Could not reach the server.");
      return;
    }
    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => ({}));
      setServerError(err.detail ?? "Invalid email or password.");
      return;
    }
    const { token } = await loginRes.json();

    let sessionRes: Response;
    try {
      sessionRes = await fetch(`${API}/user/session`, {
        headers: { "x-session-token": token },
      });
    } catch {
      setServerError("Could not reach the server.");
      return;
    }
    if (!sessionRes.ok) {
      setServerError("Authentication failed. Please try again.");
      return;
    }
    const { user } = await sessionRes.json();

    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    setCookie("wfl-session", token, { expires, sameSite: "strict" });
    setCookie("wfl-user", JSON.stringify({ name: user.name, roll: user.roll, role: user.role }), { expires, sameSite: "strict" });

    // Role-based routing
    if (user.role === "Student") {
      router.replace("/student");
    } else if (user.role === "HOD") {
      router.replace("/hod/hod");
    } else {
      router.replace("/faculty");
    }
  };

  return (
    <div className="flex min-h-screen bg-[#09090b]">

      {/* ── Left brand panel ─────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[42%] flex-col justify-between p-12 relative overflow-hidden border-r border-zinc-800"
        style={{
          backgroundColor: "#0a0a0a",
          backgroundImage: `
            radial-gradient(ellipse 70% 55% at 15% 50%, rgba(168,85,247,0.10) 0%, transparent 70%),
            radial-gradient(ellipse 55% 45% at 85% 20%, rgba(234,179,8,0.08) 0%, transparent 70%),
            radial-gradient(circle, #27272a 1px, transparent 1px)
          `,
          backgroundSize: "100% 100%, 100% 100%, 28px 28px",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 text-yellow-400">
          <WaffleLogo />
          <strong>
            <span className="translate-y-2 text-5xl font-sans tracking-tight text-yellow-400">
            {APP_NAME}
          </span>
          </strong>
        </div>

        {/* Tagline */}
        <div className="space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-bold text-zinc-100 leading-snug">
              The examination
              <br />
              platform built for
              <br />
              <span className="text-yellow-400">SMEC</span>
            </h2>
            <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
              Attend exams, track your progress, and get detailed
              insights — all in one place.
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

        {/* Footer */}
        <p className="text-zinc-500 text-xs">
          © {new Date().getFullYear()} SMEC. All rights reserved.
        </p>
      </div>

      {/* ── Right form panel ──────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">

          {/* Mobile-only logo */}
          <div className="flex items-center gap-2.5 text-yellow-400 lg:hidden">
            <WaffleLogo />
            <span className="text-3xl font-semibold text-zinc-100">Waffle</span>
          </div>

          {/* Card underlay */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-7 py-8 space-y-8">

          {/* Heading */}
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold text-zinc-100">Welcome back</h1>
            <p className="text-sm text-zinc-400">Sign in to your account to continue</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

            {/* Session expired */}
            {sessionExpired && (
              <div className="rounded-lg bg-amber-950/50 border border-amber-800/60 px-3.5 py-3 text-sm text-amber-400">
                Your session has expired. Please sign in again.
              </div>
            )}

            {/* Server error */}
            {serverError && (
              <div className="rounded-lg bg-red-950/50 border border-red-900/60 px-3.5 py-3 text-sm text-red-400">
                {serverError}
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@smec.ac.in"
                className={`
                  w-full rounded-lg border bg-zinc-900 px-3.5 py-2.5
                  text-sm text-zinc-100 placeholder:text-zinc-600
                  transition-colors outline-none
                  focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500
                  disabled:opacity-50
                  ${errors.email ? "border-red-800 focus:ring-red-700/50 focus:border-red-700" : "border-zinc-800 hover:border-zinc-700"}
                `}
                disabled={isSubmitting}
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-red-400">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`
                    w-full rounded-lg border bg-zinc-900 px-3.5 py-2.5 pr-10
                    text-sm text-zinc-100 placeholder:text-zinc-600
                    transition-colors outline-none
                    focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500
                    disabled:opacity-50
                    ${errors.password ? "border-red-800 focus:ring-red-700/50 focus:border-red-700" : "border-zinc-800 hover:border-zinc-700"}
                  `}
                  disabled={isSubmitting}
                  {...register("password")}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword
                    ? <EyeOff className="w-4 h-4" />
                    : <Eye className="w-4 h-4" />
                  }
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-400">{errors.password.message}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="
                w-full flex items-center justify-center gap-2
                rounded-lg bg-yellow-400 hover:bg-yellow-300
                px-4 py-2.5 text-sm font-medium text-zinc-900
                transition-colors disabled:opacity-60 disabled:cursor-not-allowed
                focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-[#09090b]
                mt-2
              "
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* Register link */}
          <p className="text-sm text-zinc-400 text-center">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-sky-400 hover:text-sky-300 font-medium transition-colors"
            >
              Create one
            </Link>
          </p>

          </div>{/* end card */}
        </div>
      </div>

    </div>
  );
}
