export type RemoteNoticeTone = "neutral" | "warning" | "error";

export interface RemoteNoticeCopy {
  title: string;
  detail: string;
  tone: RemoteNoticeTone;
}

export function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "";
}

export function getRemoteIssueCopy(
  message: string | null | undefined,
  fallback: Pick<RemoteNoticeCopy, "title" | "detail">,
): RemoteNoticeCopy {
  const normalized = (message ?? "").toLowerCase();

  if (!normalized) {
    return { ...fallback, tone: "warning" };
  }

  if (
    normalized.includes("could not find public function")
    || normalized.includes("could not find function")
    || normalized.includes("unknown function")
    || normalized.includes("listtimelinesummaries")
    || normalized.includes("getworkspacestatus")
    || normalized.includes("listsummaries")
  ) {
    return {
      title: "Cloud update still in progress",
      detail:
        "This web build is ahead of the deployed Daylens cloud functions. Reload after the backend update finishes.",
      tone: "warning",
    };
  }

  if (normalized.includes("not authenticated") || normalized.includes("401")) {
    return {
      title: "Reconnect this browser",
      detail:
        "Your browser session expired. Link this browser again from Daylens on your computer.",
      tone: "warning",
    };
  }

  return { ...fallback, tone: "warning" };
}
