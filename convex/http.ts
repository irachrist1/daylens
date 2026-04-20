import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DaySnapshot, Platform } from "../packages/snapshot-schema/snapshot";
import type {
  RemoteSyncPayload,
  WorkspaceLivePresence,
} from "../packages/remote-contract/index";

const http = httpRouter();
const DESKTOP_PLATFORMS = new Set<Platform>(["macos", "windows", "linux"]);
const CREATE_WORKSPACE_LIMIT = 50;
const RECOVER_WORKSPACE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

type DeviceRecord = {
  platform: Platform | "web";
};

type HttpCtx = {
  auth: {
    getUserIdentity(): Promise<Record<string, unknown> | null>;
  };
  runMutation(
    fn: unknown,
    args: Record<string, unknown>
  ): Promise<unknown>;
  runQuery(
    fn: unknown,
    args: Record<string, unknown>
  ): Promise<unknown>;
  runAction(
    fn: unknown,
    args: Record<string, unknown>
  ): Promise<unknown>;
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function parseDesktopPlatform(value: unknown): Platform | null {
  if (typeof value !== "string") {
    return null;
  }

  return DESKTOP_PLATFORMS.has(value as Platform)
    ? (value as Platform)
    : null;
}

function isValidSnapshot(snapshot: unknown): snapshot is DaySnapshot {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  const candidate = snapshot as Record<string, unknown>;
  const hasArrayField = (key: string) => Array.isArray(candidate[key]);

  // Normalize categoryOverrides: accept missing, null, or array by converting to {}
  if (
    candidate.categoryOverrides === undefined ||
    candidate.categoryOverrides === null ||
    Array.isArray(candidate.categoryOverrides) ||
    typeof candidate.categoryOverrides !== "object"
  ) {
    candidate.categoryOverrides = {};
  }

  const isBaseSnapshot =
    (candidate.schemaVersion === 1 || candidate.schemaVersion === 2) &&
    typeof candidate.deviceId === "string" &&
    parseDesktopPlatform(candidate.platform) !== null &&
    typeof candidate.date === "string" &&
    typeof candidate.generatedAt === "string" &&
    typeof candidate.isPartialDay === "boolean" &&
    typeof candidate.focusScore === "number" &&
    typeof candidate.focusSeconds === "number" &&
    hasArrayField("appSummaries") &&
    hasArrayField("categoryTotals") &&
    hasArrayField("timeline") &&
    hasArrayField("topDomains") &&
    (candidate.aiSummary === null ||
      candidate.aiSummary === undefined ||
      typeof candidate.aiSummary === "string") &&
    hasArrayField("focusSessions");

  if (!isBaseSnapshot) {
    return false;
  }

  if (candidate.schemaVersion === 1) {
    return true;
  }

  return (
    typeof candidate.focusScoreV2 === "object" &&
    candidate.focusScoreV2 !== null &&
    hasArrayField("workBlocks") &&
    typeof candidate.recap === "object" &&
    candidate.recap !== null &&
    typeof candidate.coverage === "object" &&
    candidate.coverage !== null &&
    hasArrayField("topWorkstreams") &&
    hasArrayField("standoutArtifacts") &&
    hasArrayField("entities") &&
    (typeof candidate.privacyFiltered === "boolean" ||
      typeof candidate.hiddenByPreferences === "boolean")
  );
}

function isValidPresencePayload(payload: unknown): payload is WorkspaceLivePresence {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.contractVersion === "string" &&
    typeof candidate.deviceId === "string" &&
    typeof candidate.localDate === "string" &&
    typeof candidate.state === "string" &&
    typeof candidate.heartbeatAt === "number" &&
    typeof candidate.capturedAt === "number" &&
    typeof candidate.lastMeaningfulCaptureAt === "number"
  );
}

function isValidRemoteSyncPayload(payload: unknown): payload is RemoteSyncPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.contractVersion === "string" &&
    typeof candidate.deviceId === "string" &&
    typeof candidate.localDate === "string" &&
    typeof candidate.generatedAt === "string" &&
    !!candidate.daySummary &&
    Array.isArray(candidate.workBlocks) &&
    Array.isArray(candidate.entities) &&
    Array.isArray(candidate.artifacts)
  );
}

function normalizeLegacyRemoteSyncPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const candidate = payload as Record<string, unknown>;
  const daySummary =
    candidate.daySummary && typeof candidate.daySummary === "object"
      ? { ...(candidate.daySummary as Record<string, unknown>) }
      : null;

  if (!daySummary) {
    return payload;
  }

  if (
    typeof daySummary.privacyFiltered !== "boolean" &&
    typeof daySummary.hiddenByPreferences === "boolean"
  ) {
    daySummary.privacyFiltered = daySummary.hiddenByPreferences;
  }

  delete daySummary.hiddenByPreferences;

  return {
    ...candidate,
    daySummary,
  };
}

async function recordSyncFailure(
  ctx: HttpCtx,
  args: {
    workspaceId: Id<"workspaces">;
    deviceId: string;
    localDate: string | null;
    reason: string;
    detail?: string | null;
    contractVersion?: string | null;
  }
) {
  await ctx.runMutation(internal.remoteSync.recordFailure, {
    workspaceId: args.workspaceId,
    deviceId: args.deviceId,
    failure: {
      contractVersion: args.contractVersion ?? "unknown",
      deviceId: args.deviceId,
      localDate: args.localDate,
      failedAt: Date.now(),
      reason: args.reason,
      detail: args.detail ?? null,
    },
  });
}

async function enforceRateLimit(
  ctx: HttpCtx,
  req: Request,
  namespace: string,
  limit: number
) {
  const result = (await ctx.runMutation(
    internal.httpRateLimits.checkAndIncrement,
    {
      namespace,
      key: getClientIp(req),
      limit,
      windowMs: RATE_LIMIT_WINDOW_MS,
    }
  )) as RateLimitResult;

  if (!result.allowed) {
    return jsonResponse(
      {
        error: "Too many requests. Please try again later.",
        retryAfterMs: result.retryAfterMs,
      },
      429
    );
  }

  return null;
}

http.route({
  path: "/remote/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const workspaceId = identity.workspaceId as Id<"workspaces">;
    const sessionDeviceId = identity.deviceId;
    if (typeof sessionDeviceId !== "string") {
      return jsonResponse({ error: "Missing device" }, 400);
    }

    const body = await req.json();
    if (!isValidPresencePayload(body)) {
      return jsonResponse({ error: "Invalid live presence payload" }, 400);
    }

    const registeredDevice = (await ctx.runQuery(
      internal.devices.getByWorkspaceAndDeviceId,
      {
        workspaceId,
        deviceId: sessionDeviceId,
      }
    )) as DeviceRecord | null;

    if (!registeredDevice) {
      return jsonResponse({ error: "Unknown device" }, 403);
    }

    if (body.deviceId !== sessionDeviceId) {
      return jsonResponse({ error: "Presence identity mismatch" }, 403);
    }

    await ctx.runMutation(internal.remoteSync.recordHeartbeat, {
      workspaceId,
      deviceId: sessionDeviceId,
      presence: body,
    });

    return jsonResponse({ success: true }, 200);
  }),
});

http.route({
  path: "/remote/syncDay",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const workspaceId = identity.workspaceId as Id<"workspaces">;
    const sessionDeviceId = identity.deviceId;
    if (typeof sessionDeviceId !== "string") {
      return jsonResponse({ error: "Missing device" }, 400);
    }

    const rawBody = await req.json();
    const body = normalizeLegacyRemoteSyncPayload(rawBody);
    if (!isValidRemoteSyncPayload(body)) {
      await recordSyncFailure(ctx, {
        workspaceId,
        deviceId: sessionDeviceId,
        localDate: typeof (rawBody as { localDate?: unknown })?.localDate === "string"
          ? ((rawBody as { localDate: string }).localDate)
          : null,
        reason: "invalid_payload",
        detail: "Invalid remote sync payload",
        contractVersion: typeof (rawBody as { contractVersion?: unknown })?.contractVersion === "string"
          ? ((rawBody as { contractVersion: string }).contractVersion)
          : null,
      });
      return jsonResponse({ error: "Invalid remote sync payload" }, 400);
    }

    const registeredDevice = (await ctx.runQuery(
      internal.devices.getByWorkspaceAndDeviceId,
      {
        workspaceId,
        deviceId: sessionDeviceId,
      }
    )) as DeviceRecord | null;

    if (!registeredDevice) {
      return jsonResponse({ error: "Unknown device" }, 403);
    }

    if (body.deviceId !== sessionDeviceId || body.daySummary.deviceId !== sessionDeviceId) {
      await recordSyncFailure(ctx, {
        workspaceId,
        deviceId: sessionDeviceId,
        localDate: body.localDate,
        reason: "identity_mismatch",
        detail: "Remote sync identity mismatch",
        contractVersion: body.contractVersion,
      });
      return jsonResponse({ error: "Remote sync identity mismatch" }, 403);
    }

    try {
      await ctx.runMutation(internal.remoteSync.syncDay, {
        workspaceId,
        deviceId: sessionDeviceId,
        payload: body,
      });
      return jsonResponse({ success: true }, 200);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await recordSyncFailure(ctx, {
        workspaceId,
        deviceId: sessionDeviceId,
        localDate: body.localDate,
        reason: "sync_day_failed",
        detail,
        contractVersion: body.contractVersion,
      });
      return jsonResponse({ error: "Remote day sync failed" }, 500);
    }
  }),
});

http.route({
  path: "/uploadSnapshot",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const body = await req.json();
    const { localDate, snapshot } = body;
    const workspaceId = identity.workspaceId as Id<"workspaces">;
    const deviceId = identity.deviceId;

    if (typeof deviceId !== "string" || typeof localDate !== "string") {
      console.error("[uploadSnapshot] Missing deviceId or localDate", { deviceId: typeof deviceId, localDate: typeof localDate });
      return jsonResponse({ error: "Missing or invalid required fields" }, 400);
    }

    if (!isValidSnapshot(snapshot)) {
      const s = snapshot as Record<string, unknown> | null;
      console.error("[uploadSnapshot] Invalid snapshot", {
        schemaVersion: s?.schemaVersion,
        hasDeviceId: typeof s?.deviceId === "string",
        platform: s?.platform,
        date: s?.date,
        hasAppSummaries: Array.isArray(s?.appSummaries),
        hasFocusSessions: Array.isArray(s?.focusSessions),
      });
      return jsonResponse({ error: "Missing or invalid required fields" }, 400);
    }

    try {
      const registeredDevice = (await ctx.runQuery(
        internal.devices.getByWorkspaceAndDeviceId,
        {
          workspaceId,
          deviceId,
        }
      )) as DeviceRecord | null;

      if (!registeredDevice) {
        return jsonResponse({ error: "Unknown device" }, 403);
      }

      if (
        snapshot.deviceId !== deviceId ||
        snapshot.date !== localDate ||
        snapshot.platform !== registeredDevice.platform
      ) {
        return jsonResponse({ error: "Snapshot identity mismatch" }, 403);
      }

      const id = await ctx.runMutation(internal.snapshots.upload, {
        workspaceId,
        deviceId,
        localDate,
        snapshot,
      });

      await ctx.runMutation(internal.snapshots.recordSync, {
        workspaceId,
        deviceId,
      });

      console.log("[uploadSnapshot] OK", { localDate, deviceId, id });
      return jsonResponse({ success: true, id }, 200);
    } catch (err) {
      console.error("[uploadSnapshot] Upload failed", { localDate, deviceId, error: err instanceof Error ? err.message : String(err) });
      return jsonResponse({ error: "Upload failed" }, 500);
    }
  }),
});

http.route({
  path: "/createWorkspace",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const rateLimited = await enforceRateLimit(
      ctx,
      req,
      "createWorkspace",
      CREATE_WORKSPACE_LIMIT
    );
    if (rateLimited) {
      return rateLimited;
    }

    const body = await req.json();
    const { recoveryKeyHash } = body;

    if (!recoveryKeyHash) {
      return jsonResponse({ error: "Missing recoveryKeyHash" }, 400);
    }

    const result = (await ctx.runMutation(internal.workspaces.create, {
      recoveryKeyHash,
    })) as { workspaceId: Id<"workspaces"> };

    const deviceId =
      typeof body.deviceId === "string" ? body.deviceId : "desktop-device";
    const displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim()
        : "This Computer";
    const platform = parseDesktopPlatform(body.platform) ?? "macos";

    await ctx.runMutation(internal.devices.upsertForWorkspace, {
      workspaceId: result.workspaceId,
      deviceId,
      platform,
      displayName,
    });

    const session = (await ctx.runAction(internal.sessionTokens.issue, {
      workspaceId: result.workspaceId,
      deviceId,
      sessionKind: "desktop",
    })) as { token: string; expiresAt: number };

    return jsonResponse(
      {
        workspaceId: result.workspaceId,
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt,
      },
      200
    );
  }),
});

http.route({
  path: "/recoverWorkspace",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const rateLimited = await enforceRateLimit(
      ctx,
      req,
      "recoverWorkspace",
      RECOVER_WORKSPACE_LIMIT
    );
    if (rateLimited) {
      return rateLimited;
    }

    const body = await req.json();
    const { recoveryKeyHash } = body;

    if (!recoveryKeyHash) {
      return jsonResponse({ error: "Missing recoveryKeyHash" }, 400);
    }

    const result = (await ctx.runQuery(internal.workspaces.recover, {
      recoveryKeyHash,
    })) as { workspaceId: Id<"workspaces"> | null };

    if (!result.workspaceId) {
      return jsonResponse({ error: "Workspace not found" }, 404);
    }

    const deviceId =
      typeof body.deviceId === "string" ? body.deviceId : "desktop-device";
    const displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim()
        : "This Computer";
    const platform = parseDesktopPlatform(body.platform) ?? "macos";

    await ctx.runMutation(internal.devices.upsertForWorkspace, {
      workspaceId: result.workspaceId,
      deviceId,
      platform,
      displayName,
    });

    const session = (await ctx.runAction(internal.sessionTokens.issue, {
      workspaceId: result.workspaceId,
      deviceId,
      sessionKind: "desktop",
    })) as { token: string; expiresAt: number };

    return jsonResponse(
      {
        workspaceId: result.workspaceId,
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt,
      },
      200
    );
  }),
});

http.route({
  path: "/createLinkCode",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const body = await req.json();
    const { tokenHash, displayCode } = body;

    if (!tokenHash || !displayCode) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    if (typeof identity.workspaceId !== "string") {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    const result = await ctx.runMutation(internal.linkCodes.create, {
      workspaceId: identity.workspaceId as Id<"workspaces">,
      tokenHash,
      displayCode,
    });

    return jsonResponse(result, 200);
  }),
});

http.route({
  path: "/storeApiKey",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const body = await req.json();
    const { anthropicKey } = body;

    if (!anthropicKey) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    if (typeof identity.workspaceId !== "string") {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    await ctx.runAction(internal.keys.store, {
      workspaceId: identity.workspaceId as Id<"workspaces">,
      anthropicKey,
    });

    return jsonResponse({ success: true }, 200);
  }),
});

export default http;
