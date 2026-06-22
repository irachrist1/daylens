export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function localDayBounds(dateStr: string): [number, number] {
  const [year, month, day] = dateStr.split('-').map(Number)
  const from = new Date(year, month - 1, day).getTime()
  const to = new Date(year, month - 1, day + 1).getTime()
  return [from, to]
}

export function daysFromTodayLocalDateString(offsetDays: number): string {
  const today = new Date()
  return localDateString(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays),
  )
}

export function shiftLocalDateString(dateStr: string, offsetDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return localDateString(new Date(year, month - 1, day + offsetDays))
}
