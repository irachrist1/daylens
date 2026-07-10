// Formatting utilities shared across views

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

// Returns e.g. "Monday, March 18" from a YYYY-MM-DD string.
// Parses via components to stay timezone-safe.
export function formatFullDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function localDateStringFromMs(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function shiftDateString(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return localDateStringFromMs(new Date(y, m - 1, d + offsetDays).getTime())
}

export function weekStartString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d)
  const day = next.getDay()
  next.setDate(next.getDate() + (day === 0 ? -6 : 1 - day))
  return localDateStringFromMs(next.getTime())
}

// Returns today's date as a local YYYY-MM-DD string.
// DO NOT use new Date().toISOString().split('T')[0] — that returns the UTC date
// which is wrong in UTC- timezones after ~7 pm local time.
export function todayString(): string {
  return localDateStringFromMs(Date.now())
}

export function dayBounds(dateStr: string): [number, number] {
  const [y, m, d] = dateStr.split('-').map(Number)
  const from = new Date(y, m - 1, d).getTime()
  const to = new Date(y, m - 1, d + 1).getTime()
  return [from, to]
}
