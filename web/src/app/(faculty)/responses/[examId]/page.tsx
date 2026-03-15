import ResponsesView from "@/components/responses/ResponsesView";

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  return <ResponsesView examId={Number(examId)} />;
}
