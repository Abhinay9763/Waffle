import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/login", "/register", "/users/auth"];

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
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };
