import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/login", "/register", "/users/auth", "/forgot-password", "/reset-password", "/invite"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/api")) return NextResponse.next();

  if (!req.cookies.get("wfl-session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/exam/")) {
    const rawUser = req.cookies.get("wfl-user")?.value;
    if (!rawUser) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    try {
      const parsed = JSON.parse(rawUser) as { role?: string };
      if (parsed.role !== "Student") {
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        return NextResponse.redirect(url);
      }
    } catch {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"] };
