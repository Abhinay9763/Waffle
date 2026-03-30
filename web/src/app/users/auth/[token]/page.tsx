import Link from "next/link";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
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
  let userData: { role?: string; approval_status?: string } = {};

  try {
    const res = await fetch(`${API}/user/auth/${token}`, { cache: "no-store" });
    if (res.ok) {
      success = true;
      const data = await res.json();
      userData = {
        role: data.role,
        approval_status: data.approval_status
      };
    } else if (res.status === 409) {
      alreadyActivated = true;
      const data = await res.json().catch(() => ({}));
      detail = data.detail || "Account already activated.";
    } else {
      const data = await res.json().catch(() => ({}));
      detail = data.detail ?? "Invalid or expired link.";
    }
  } catch {
    detail = "Could not reach the server.";
  }

  // Check if this is a faculty user who needs approval (only for first activation)
  const isFacultyPending = success && userData.role === "Faculty" && userData.approval_status === "pending";

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">

        <p className="text-sm font-semibold text-zinc-500 tracking-widest uppercase">
          {APP_NAME}
        </p>

        {success ? (
          <>
            {isFacultyPending ? (
              <>
                <div className="space-y-2">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                  <Clock className="w-8 h-8 text-amber-400 mx-auto" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-xl font-semibold text-zinc-100">Email verified!</h1>
                  <div className="space-y-1">
                    <p className="text-sm text-zinc-500">Your email has been successfully verified.</p>
                    <div className="flex items-center justify-center gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
                      <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <p className="text-sm text-amber-200">
                        Pending approval from Head of Department
                      </p>
                    </div>
                    <p className="text-xs text-zinc-600">
                      You&apos;ll be able to sign in once the HOD approves your faculty account.
                    </p>
                  </div>
                </div>
                <div className="pt-2">
                  <div className="text-center">
                    <p className="text-xs text-zinc-500 mb-3">
                      Try signing in after approval
                    </p>
                    <Link
                      href="/login"
                      className="inline-flex items-center justify-center w-full border border-zinc-700 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
                    >
                      Go to sign in
                    </Link>
                  </div>
                </div>
              </>
            ) : (
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
            )}
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
