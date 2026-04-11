import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import PaperBuilder from "@/components/papers/PaperBuilder";
import { API } from "@/lib/config";

export default async function HodPaperDetailPage({
  params,
}: {
  params: Promise<{ paperId: string }>;
}) {
  const { paperId } = await params;
  const token = (await cookies()).get("wfl-session")?.value;
  if (!token) redirect("/login");

  const res = await fetch(`${API}/paper/${paperId}`, {
    headers: { "x-session-token": token },
    cache: "no-store",
  }).catch(() => null);

  if (!res) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Could not reach the server.
      </div>
    );
  }

  if (res.status === 404) notFound();
  if (!res.ok) redirect("/hod/papers");

  const data = await res.json();
  const q = data.questions ?? {};
  const meta = q.meta ?? {};

  const initialData = {
    examName: meta.exam_name ?? "",
    sections: q.sections ?? [],
    answers: data.answers ?? {},
  };

  return (
    <PaperBuilder
      paperId={data.id}
      initialData={initialData}
      inUse={data.in_use ?? false}
      usedInExamHistory={data.used_in_exam_history ?? false}
      canEdit={data.can_edit ?? false}
      basePath="/hod/papers"
    />
  );
}
