import FacultySidebar from "@/components/layout/FacultySidebar";

export default function FacultyLayout({ children }: { children: React.ReactNode }) {
  // TODO: add requireFacultySession() once auth is wired up
  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      <FacultySidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden pb-20 md:pb-0">
        {children}
      </main>
    </div>
  );
}
