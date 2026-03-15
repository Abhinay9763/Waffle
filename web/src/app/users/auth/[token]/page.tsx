import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { API, APP_NAME } from "@/lib/config";

export default async function ActivatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let success = false;
  let detail = "";
  let alreadyActivated = false;

  try {
    const res = await fetch(`${API}/user/auth/${token}`, { cache: "no-store" });
    if (res.ok) {
      success = true;
    } else if (res.status === 409) {
      alreadyActivated = true;
      detail = "This account has already been activated.";
    } else {
      const data = await res.json().catch(() => ({}));
      detail = data.detail ?? "Invalid or expired link.";
    }
  } catch {
    detail = "Could not reach the server.";
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">

        <p className="text-sm font-semibold text-zinc-500 tracking-widest uppercase">
          {APP_NAME}
        </p>

        {success ? (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-zinc-100">Account activated</h1>
              <p className="text-sm text-zinc-500">Your account is ready. You can sign in now.</p>
            </div>
            <Link
              href="/login"
              className="inline-flex items-center justify-center w-full bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              Sign in
            </Link>
          </>
        ) : alreadyActivated ? (
          <>
            <CheckCircle2 className="w-12 h-12 text-amber-400 mx-auto" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-zinc-100">Already activated</h1>
              <p className="text-sm text-zinc-500">{detail}</p>
            </div>
            <Link
              href="/login"
              className="inline-flex items-center justify-center w-full bg-yellow-400 hover:bg-yellow-300 text-zinc-900 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            <XCircle className="w-12 h-12 text-red-400 mx-auto" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-zinc-100">Activation failed</h1>
              <p className="text-sm text-zinc-500">{detail}</p>
            </div>
            <Link
              href="/register"
              className="inline-flex items-center justify-center w-full border border-zinc-700 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              Back to register
            </Link>
          </>
        )}

      </div>
    </div>
  );
}
