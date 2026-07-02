// ---------------------------------------------------------------------------
// Activity colors — the single source of truth for block/category colors across
// the day grid, week grid, month dots, and inspector. Blocks render each color
// as a translucent fill plus a full-strength border, so every hex here must hold
// up against both the light and dark themes. Change a category's accent here and
// every surface follows.
// ---------------------------------------------------------------------------

import type { AppCategory } from './types'

// Exhaustive map of every AppCategory to its accent hex, grouped by the kind of
// activity it represents. The `Record<AppCategory, string>` type keeps this
// exhaustive: the compiler will flag a missing entry when a new category is
// added, so the palette can never silently fall through to grey.
export const ACTIVITY_COLORS: Record<AppCategory, string> = {
  // Coding / engineering
  development: '#3b82f6',

  // Writing / docs
  writing: '#ca8a04',
  email: '#ca8a04',
  productivity: '#ca8a04',
  design: '#ca8a04',

  // Meetings / communication
  meetings: '#8b5cf6',
  communication: '#8b5cf6',

  // Entertainment / leisure
  entertainment: '#ef4444',
  social: '#ef4444',

  // Browsing / research / AI
  browsing: '#64748b',
  research: '#64748b',
  aiTools: '#64748b',

  // Neutral
  system: '#94a3b8',
  uncategorized: '#94a3b8',
}

// Resolve a category to its accent, falling back to the neutral uncategorized
// grey for any value that isn't in the map (e.g. untrusted/legacy input).
export function activityColorForCategory(category: AppCategory): string {
  return ACTIVITY_COLORS[category] ?? ACTIVITY_COLORS.uncategorized
}
