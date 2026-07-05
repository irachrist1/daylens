import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "@/app/lib/sessionConfig";

export interface Session {
  token: string;
  workspaceId?: string;
  deviceId?: string;
  sessionKind?: "desktop" | "web";
  expiresAt?: number;
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  try {
    const { payload } = await verifySessionToken(raw);
    const exp = typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
    if (exp && exp <= Date.now()) {
      return null;
    }
    if (payload.sessionKind !== "web") {
      return null;
    }

    return {
      token: raw,
      workspaceId:
        typeof payload.workspaceId === "string" ? payload.workspaceId : undefined,
      deviceId: typeof payload.deviceId === "string" ? payload.deviceId : undefined,
      sessionKind: "web",
      expiresAt: exp,
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/daylens; HttpOnly; SameSite=Strict; Secure; Max-Age=${60 * 60 * 24 * 30}`;
}
