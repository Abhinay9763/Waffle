import ResponsesView from "@/components/responses/ResponsesView";

export default async function HodResponseDetailPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  return <ResponsesView examId={Number(examId)} basePath="/hod/responses" />;
}
