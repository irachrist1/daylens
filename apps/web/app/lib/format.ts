/** Format seconds as "Xh Ym" */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Format ISO timestamp as relative time like "5 minutes ago" */
export function formatRelativeTime(timestamp: number | string): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : new Date(timestamp);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/** Format a date string for display */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Format full date for page headers */
export function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Category display colors — matches desktop app exactly */
export const CATEGORY_COLORS: Record<string, string> = {
  development: "#5b8cff",
  communication: "#f97316",
  research: "#7c5cff",
  writing: "#a855f7",
  aiTools: "#c084fc",
  design: "#ec4899",
  browsing: "#fb923c",
  meetings: "#14b8a6",
  entertainment: "#f59e0b",
  email: "#38bdf8",
  productivity: "#6366f1",
  social: "#f43f5e",
  system: "#94a3b8",
  uncategorized: "#94a3b8",
};

/** Category display labels */
export const CATEGORY_LABELS: Record<string, string> = {
  development: "Development",
  communication: "Communication",
  research: "Research",
  writing: "Writing",
  aiTools: "AI tools",
  design: "Design",
  browsing: "Browsing",
  meetings: "Meetings",
  entertainment: "Entertainment",
  email: "Email",
  productivity: "Productivity",
  social: "Social",
  system: "System",
  uncategorized: "Uncategorized",
};
