import { NextRequest, NextResponse } from "next/server";
import { withBasePath } from "@/app/lib/basePath";

export async function POST(request: NextRequest) {
  const url = new URL(withBasePath("/"), request.url);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: "daylens_session", path: "/daylens" });
  return response;
}
