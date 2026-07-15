import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE } from "@/lib/api/client";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/subjects",
  "/tasks",
  "/pretest",
  "/mistakes",
  "/settings",
];

const AUTH_ONLY_PREFIXES = ["/login", "/register"];

function startsWithAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(AUTH_COOKIE)?.value;

  if (!token && startsWithAny(pathname, PROTECTED_PREFIXES)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (token && startsWithAny(pathname, AUTH_ONLY_PREFIXES)) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};
