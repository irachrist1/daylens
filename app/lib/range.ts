"use client";

export type SurfaceRange = "day" | "week" | "month";

export function todayLocalDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function parseSurfaceRange(value: string | null | undefined): SurfaceRange {
  return value === "week" || value === "month" ? value : "day";
}

function toDateParts(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  return { year, month, day };
}

export function localDateToDate(localDate: string) {
  const { year, month, day } = toDateParts(localDate);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function toLocalDateString(date: Date) {
  return date.toLocaleDateString("en-CA");
}

export function shiftLocalDate(localDate: string, deltaDays: number) {
  const next = localDateToDate(localDate);
  next.setDate(next.getDate() + deltaDays);
  return toLocalDateString(next);
}

export function shiftRangeAnchor(localDate: string, range: SurfaceRange, direction: -1 | 1) {
  const next = localDateToDate(localDate);
  if (range === "month") {
    next.setMonth(next.getMonth() + direction);
  } else {
    next.setDate(next.getDate() + (range === "week" ? 7 : 1) * direction);
  }
  return toLocalDateString(next);
}

export function getWeekStart(localDate: string) {
  const next = localDateToDate(localDate);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return toLocalDateString(next);
}

export function getWeekEnd(localDate: string) {
  return shiftLocalDate(getWeekStart(localDate), 6);
}

export function getMonthStart(localDate: string) {
  const next = localDateToDate(localDate);
  next.setDate(1);
  return toLocalDateString(next);
}

export function getMonthEnd(localDate: string) {
  const next = localDateToDate(localDate);
  next.setMonth(next.getMonth() + 1, 0);
  return toLocalDateString(next);
}

export function getRangeBounds(localDate: string, range: SurfaceRange) {
  if (range === "week") {
    return {
      from: getWeekStart(localDate),
      to: getWeekEnd(localDate),
    };
  }

  if (range === "month") {
    return {
      from: getMonthStart(localDate),
      to: getMonthEnd(localDate),
    };
  }

  return {
    from: localDate,
    to: localDate,
  };
}

export function rangeIncludesDate(range: SurfaceRange, anchorDate: string, localDate: string) {
  const { from, to } = getRangeBounds(anchorDate, range);
  return localDate >= from && localDate <= to;
}

export function listRangeDates(localDate: string, range: SurfaceRange) {
  const { from, to } = getRangeBounds(localDate, range);
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = shiftLocalDate(cursor, 1);
  }
  return dates;
}

export function formatRangeLabel(localDate: string, range: SurfaceRange) {
  const current = localDateToDate(localDate);
  if (range === "day") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(current);
  }

  if (range === "week") {
    const start = localDateToDate(getWeekStart(localDate));
    const end = localDateToDate(getWeekEnd(localDate));
    const startLabel = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(start);
    const endLabel = new Intl.DateTimeFormat(undefined, {
      month: start.getMonth() === end.getMonth() ? undefined : "short",
      day: "numeric",
    }).format(end);
    return `${startLabel} – ${endLabel}`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(current);
}

export function formatLongRangeLabel(localDate: string, range: SurfaceRange) {
  if (range === "day") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(localDateToDate(localDate));
  }

  if (range === "week") {
    const start = localDateToDate(getWeekStart(localDate));
    const end = localDateToDate(getWeekEnd(localDate));
    return `${new Intl.DateTimeFormat(undefined, {
      month: "long",
      day: "numeric",
    }).format(start)} – ${new Intl.DateTimeFormat(undefined, {
      month: start.getMonth() === end.getMonth() ? undefined : "long",
      day: "numeric",
      year: "numeric",
    }).format(end)}`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(localDateToDate(localDate));
}

export function buildSurfaceHref(pathname: string, localDate: string, range: SurfaceRange) {
  const params = new URLSearchParams();
  params.set("date", localDate);
  if (range !== "day") {
    params.set("range", range);
  }
  return `${pathname}?${params.toString()}`;
}
