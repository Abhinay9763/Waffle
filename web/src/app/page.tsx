import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API } from "@/lib/config";

export default async function RootPage() {
  const token = (await cookies()).get("wfl-session")?.value;
  if (!token) redirect("/login");

  const res = await fetch(`${API}/user/session`, {
    headers: { "x-session-token": token },
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) redirect("/login");

  const { user } = await res.json();
  if (user.role === "Student") redirect("/student");
  redirect("/faculty");
}
