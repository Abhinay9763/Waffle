"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import { API } from "@/lib/config";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const res = await fetch(`${API}/user/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);

    setSubmitting(false);

    if (!res?.ok) {
      setMessage("Could not process request right now. Please try again.");
      return;
    }

    const body = await res.json().catch(() => ({}));
    setMessage(typeof body?.msg === "string" ? body.msg : "If that email exists, a password reset link has been sent.");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-7 space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-zinc-100">Forgot Password</h1>
          <p className="text-sm text-zinc-500">Enter your email to receive a password reset link.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm text-zinc-300">Email</label>
            <div className="relative">
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 pr-10 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-yellow-500/50"
              />
              <Mail className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-yellow-400 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-yellow-300 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Sending...</span>
            ) : (
              "Send reset link"
            )}
          </button>
        </form>

        {message && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
            {message}
          </div>
        )}

        <p className="text-center text-sm text-zinc-500">
          Remembered your password?{" "}
          <Link href="/login" className="text-sky-400 hover:text-sky-300">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
