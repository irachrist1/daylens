import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "@/app/lib/sessionConfig";

const PUBLIC_PATHS = ["/", "/link", "/recover", "/docs", "/roadmap", "/changelog"];
const PUBLIC_API_PATHS = [
  "/api/link",
  "/api/recover",
  "/api/logout",
  "/api/chat",
  "/api/download/mac",
  "/api/download/windows",
  "/api/download/linux",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"))) {
    return NextResponse.next();
  }

  if (PUBLIC_API_PATHS.some((path) => pathname === path)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/link";
    return NextResponse.redirect(url);
  }

  try {
    const { payload } = await verifySessionToken(session);

    if (
      typeof payload.workspaceId !== "string" ||
      typeof payload.exp !== "number" ||
      payload.sessionKind !== "web" ||
      payload.exp * 1000 <= Date.now()
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/link";
      return NextResponse.redirect(url);
    }
  } catch {
    const url = request.nextUrl.clone();
    url.pathname = "/link";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-.*|manifest.json|sw.js|workbox-.*).*)"],
};
