import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function StudentExamPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const token = (await cookies()).get("wfl-session")?.value;
  if (!token) redirect("/login");

  const { examId } = await params;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-3xl items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-8 shadow-lg shadow-black/30">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Exam Mode</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Choose how you want to take this exam</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Normal mode uses the standard exam interface. Blind mode adds voice guidance and requires microphone access.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href={`/exam/${examId}/normal`}
            className="group rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-5 transition hover:border-emerald-600 hover:bg-emerald-900/30"
          >
            <p className="text-sm font-semibold text-emerald-300">Normal Mode</p>
            <p className="mt-2 text-xs text-zinc-300">Standard keyboard and mouse based exam flow.</p>
          </Link>

          <Link
            href={`/exam/${examId}/blind`}
            className="group rounded-xl border border-amber-800/60 bg-amber-950/20 p-5 transition hover:border-amber-600 hover:bg-amber-900/30"
          >
            <p className="text-sm font-semibold text-amber-300">Blind Mode</p>
            <p className="mt-2 text-xs text-zinc-300">Voice-guided mode with text-to-speech and speech recognition.</p>
          </Link>
        </div>

        <div className="mt-6 rounded-xl border border-red-900/50 bg-red-950/20 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-red-300/90">Exam Policy</p>
          <ul className="mt-3 space-y-2 text-xs text-zinc-300">
            <li>Do not switch tabs or leave the exam window during the test.</li>
            <li>Do not exit fullscreen mode once the exam starts.</li>
            <li>Copy/paste, screenshots, and suspicious activity may be logged as policy events.</li>
            <li>Repeated violations increase warnings and can lead to automatic submission.</li>
            <li>If auto-submitted due to policy limits, you cannot continue the same attempt.</li>
          </ul>
        </div>

        <Link href="/student" className="mt-8 inline-block text-xs text-yellow-400 hover:text-yellow-300">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
