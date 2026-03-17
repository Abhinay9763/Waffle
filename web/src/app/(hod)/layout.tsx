import HODSidebar from "@/components/layout/HODSidebar";

export default function HODLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <HODSidebar />
      <main className="flex-1 overflow-hidden bg-zinc-950">
        {children}
      </main>
    </div>
  );
}