"use client";

import { usePathname } from "next/navigation";
import StudentSidebar from "@/components/layout/StudentSidebar";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isExamRoute = pathname.startsWith("/exam/");

  if (isExamRoute) {
    return <div className="h-screen overflow-hidden bg-zinc-950">{children}</div>;
  }

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      <StudentSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden pb-20 md:pb-0">{children}</main>
    </div>
  );
}
