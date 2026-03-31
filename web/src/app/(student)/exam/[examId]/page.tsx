import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import ExamRunner from "@/components/student/ExamRunner";
import { API } from "@/lib/config";
import { ExamStructure } from "@/components/student/types";

export default async function StudentExamPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const token = (await cookies()).get("wfl-session")?.value;
  if (!token) redirect("/login");

  const { examId } = await params;
  const res = await fetch(`${API}/exam/${examId}/take`, {
    headers: { "x-session-token": token },
    cache: "no-store",
  }).catch(() => null);

  if (!res) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Could not reach the server.</p>
          <Link href="/student" className="text-xs text-yellow-400 hover:text-yellow-300">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">{body.detail ?? "Could not load exam."}</p>
          <Link href="/student" className="text-xs text-yellow-400 hover:text-yellow-300">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const examData = (await res.json()) as ExamStructure;
  return <ExamRunner exam={examData} />;
}
