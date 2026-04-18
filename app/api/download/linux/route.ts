import { NextResponse } from "next/server";
import { LINUX_STATUS_HREF } from "@/app/lib/platformLinks";

export function GET(request: Request) {
  return NextResponse.redirect(new URL(LINUX_STATUS_HREF, request.url));
}
