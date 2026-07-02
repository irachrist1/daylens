// ---------------------------------------------------------------------------
// Activity colors — the single source of truth for block/category colors across
// the day grid, week grid, month dots, and inspector. Blocks render each color
// as a translucent fill plus a full-strength border, so every hex here must hold
// up against both the light and dark themes. Change a category's accent here and
// every surface follows.
//
// The user can customize these in Settings → General → Activity colors: an
// override per category is persisted in AppSettings.activityColorOverrides and
// applied at startup / on change via applyAppearanceSettings. Overrides are
// picked from the curated ACTIVITY_COLOR_CHOICES palette, per activity group
// (ACTIVITY_COLOR_GROUPS), so the calendar keeps its five-color legibility.
// ---------------------------------------------------------------------------

import type { AppCategory, AppSettings } from './types'

// Exhaustive map of every AppCategory to its default accent hex, grouped by the
// kind of activity it represents. The `Record<AppCategory, string>` type keeps
// this exhaustive: the compiler will flag a missing entry when a new category is
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

// The five user-facing color groups — the same grouping the default palette is
// built around, so customizing stays at calendar altitude (a writing block and
// an email block read as one kind of work, GCal-style) instead of a wall of 14
// per-category pickers. Neutral (system/uncategorized) is not customizable: it
// is deliberately quiet grey.
export interface ActivityColorGroup {
  id: string
  label: string
  hint: string
  categories: readonly AppCategory[]
  defaultColor: string
}

export const ACTIVITY_COLOR_GROUPS: readonly ActivityColorGroup[] = [
  { id: 'development', label: 'Development', hint: 'Coding and engineering', categories: ['development'], defaultColor: '#3b82f6' },
  { id: 'writing', label: 'Writing & docs', hint: 'Writing, email, design, productivity', categories: ['writing', 'email', 'productivity', 'design'], defaultColor: '#ca8a04' },
  { id: 'meetings', label: 'Meetings & communication', hint: 'Calls, chat, and email threads', categories: ['meetings', 'communication'], defaultColor: '#8b5cf6' },
  { id: 'leisure', label: 'Entertainment & leisure', hint: 'Video, music, social media', categories: ['entertainment', 'social'], defaultColor: '#ef4444' },
  { id: 'browsing', label: 'Browsing & research', hint: 'Reading, research, AI tools', categories: ['browsing', 'research', 'aiTools'], defaultColor: '#64748b' },
]

// The curated palette the picker offers. Every hue works as `${hex}1c` fill +
// `${hex}30` border on both themes (same treatment the block cards use), and
// each group's default is included so "picking the default" and "reset" agree.
export const ACTIVITY_COLOR_CHOICES: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Gold', hex: '#ca8a04' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Slate', hex: '#64748b' },
]

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

// Keep only well-formed overrides: known categories, #rrggbb values. Shared by
// the settings write path (so junk never persists) and the appliers (so junk
// that predates the guard never renders).
export function sanitizeActivityColorOverrides(
  value: unknown,
): Partial<Record<AppCategory, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const clean: Partial<Record<AppCategory, string>> = {}
  for (const [key, hex] of Object.entries(value as Record<string, unknown>)) {
    if (!(key in ACTIVITY_COLORS)) continue
    if (typeof hex !== 'string' || !HEX_COLOR_RE.test(hex.trim())) continue
    clean[key as AppCategory] = hex.trim().toLowerCase()
  }
  return clean
}

// ─── Applied appearance state ────────────────────────────────────────────────
// Module-level so every call site keeps the plain `activityColorForCategory(c)`
// signature. The renderer applies the persisted settings once at startup
// (App.tsx) and again whenever Settings changes them; views pick the new
// values up on their next render.

let colorOverrides: Partial<Record<AppCategory, string>> = {}
let dimLeisure = true

export function setActivityColorOverrides(overrides: unknown): void {
  colorOverrides = sanitizeActivityColorOverrides(overrides)
}

// Whether non-work (leisure/personal) blocks render slightly faded so the eye
// finds work first. On by default; Settings → General → "Dim leisure blocks".
export function setLeisureBlocksDimmed(value: boolean): void {
  dimLeisure = value !== false
}

export function leisureBlocksDimmed(): boolean {
  return dimLeisure
}

// Apply everything appearance-related from settings in one call.
export function applyAppearanceSettings(
  settings: Pick<AppSettings, 'activityColorOverrides' | 'dimLeisureBlocks'>,
): void {
  setActivityColorOverrides(settings.activityColorOverrides)
  setLeisureBlocksDimmed(settings.dimLeisureBlocks !== false)
}

// Resolve a category to its accent — the user's override first, then the
// default map, then the neutral uncategorized grey for any value that isn't in
// the map (e.g. untrusted/legacy input).
export function activityColorForCategory(category: AppCategory): string {
  return colorOverrides[category] ?? ACTIVITY_COLORS[category] ?? ACTIVITY_COLORS.uncategorized
}
