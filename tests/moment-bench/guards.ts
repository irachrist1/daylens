function minutes(hour: number, minute: number, meridiem?: string): number {
  let normalizedHour = hour
  if (meridiem?.toLowerCase() === 'pm' && normalizedHour < 12) normalizedHour += 12
  if (meridiem?.toLowerCase() === 'am' && normalizedHour === 12) normalizedHour = 0
  return normalizedHour * 60 + minute
}

export function validateIncrementRanges(answer: string, incrementMinutes: number): string[] {
  const failures: string[] = []
  const ranges: Array<{ start: number; end: number; line: string }> = []
  const pattern = /(\d{1,2}):(\d{2})\s*(am|pm)?\s*[–—-]\s*(\d{1,2}):(\d{2})\s*(am|pm)?/gi
  for (const line of answer.split('\n')) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      const trailingMeridiem = match[6] || undefined
      const start = minutes(Number(match[1]), Number(match[2]), match[3] || trailingMeridiem)
      let end = minutes(Number(match[4]), Number(match[5]), trailingMeridiem || match[3] || undefined)
      if (end <= start) end += 24 * 60
      ranges.push({ start, end, line })
    }
  }
  if (ranges.length < 2) return ['answer does not contain enough clock ranges to verify increments']

  let dayOffset = 0
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]
    if (index > 0) {
      const previous = ranges[index - 1]
      while (range.start + dayOffset < previous.start) dayOffset += 24 * 60
      range.start += dayOffset
      range.end += dayOffset
      if (range.start !== previous.end) {
        failures.push(`timeline gap or overlap between minute ${previous.end} and ${range.start}`)
      }
    }
    const duration = range.end - range.start
    if (duration === incrementMinutes) continue
    const merged = duration > incrementMinutes
      && duration % incrementMinutes === 0
      && /same (?:page|activity|evidence)/i.test(range.line)
      && /\b\d+(?:\.\d+)?\s*(?:h|hours?|m|min|minutes?)\b/i.test(range.line)
    if (!merged) failures.push(`range is ${duration} minutes; expected ${incrementMinutes} or a disclosed identical merge`)
  }
  return failures
}
