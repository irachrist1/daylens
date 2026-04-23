import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "@/app/lib/sessionConfig";
import { stripBasePath, withBasePath } from "@/app/lib/basePath";

const PUBLIC_PATHS = ["/", "/link", "/recover", "/docs", "/roadmap", "/changelog"];
const PUBLIC_API_PATHS = [
  "/api/link",
  "/api/recover",
  "/api/logout",
  "/api/chat",
  "/api/download/mac",
  "/api/download/windows",
  "/api/download/linux",
  "/api/update-feed",
];

function redirectToLink(request: NextRequest) {
  return NextResponse.redirect(new URL(withBasePath("/link"), request.url));
}

export async function middleware(request: NextRequest) {
  const pathname = stripBasePath(request.nextUrl.pathname);

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
    return redirectToLink(request);
  }

  try {
    const { payload } = await verifySessionToken(session);

    if (
      typeof payload.workspaceId !== "string" ||
      typeof payload.exp !== "number" ||
      payload.sessionKind !== "web" ||
      payload.exp * 1000 <= Date.now()
    ) {
      return redirectToLink(request);
    }
  } catch {
    return redirectToLink(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-.*|manifest.json|sw.js|workbox-.*).*)"],
};
