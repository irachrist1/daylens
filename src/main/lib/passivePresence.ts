// Passive-presence detection: is the user present-but-passive (watching a video,
// sitting in a live call or an online class, studying a course page) rather
// than truly away?
//
// Daylens flushes a session as "away" after 5 minutes with no keyboard/mouse
// input. That is right for an abandoned desk, but wrong for a 2-hour Meet class,
// a long video, or a morning of course lectures and exams: you are there,
// watching or reading, just not typing. Those must be held open as present.
//
// Two hold strengths:
//   'media'   — playback or a live call proves presence on its own, so the hold
//               is open-ended. A genuine walk-away still ends on lock/sleep.
//   'reading' — studying or long-form reading. Presence is likely but not
//               proven, so the hold is bounded by READING_HOLD_MAX_SEC; past
//               the cap the session ends back at the last real input, and a
//               lock or sleep also ends it at the last input rather than the
//               event time.

import type { AppCategory } from '@shared/types'
import type { PassiveHoldKind } from '@shared/domainCategories'

export type { PassiveHoldKind }

/** How long a 'reading' hold may keep a session open with zero input before it
 *  is treated as away after all. Long enough for a full lecture video; the
 *  session then ends at the last input, so the capped stretch is never counted
 *  when the user really left. */
export const READING_HOLD_MAX_SEC = 3600

export type PassivePresenceInput = {
  category: AppCategory
  bundleId: string
  appName: string
  rawAppName: string
  windowTitle: string | null
  passivePresence?: boolean
  passiveHold?: PassiveHoldKind | null
}

// Lean-back media: a video or music surface, watched not driven.
const PASSIVE_MEDIA_RE =
  /\b(netflix|youtube|youtu\.be|hulu|disney|prime video|amazon video|plex|twitch|vimeo|vlc|quicktime|music|spotify)\b/

// A live call or online class. Google Meet's browser tab title leads with
// "Meet - <name>" (so we match a leading "meet" followed by a separator, which
// "team meeting" or "let's meet up" do not). Zoom/Teams/Webex are matched by
// name, and native call apps come through the 'meetings' category above.
const LIVE_CALL_OR_CLASS_RE =
  /\b(google meet|meet\.google|zoom|webex|whereby|jitsi|gather\.town|microsoft teams|teams meeting)\b|(^|\s)meet\s*[–—:|·-]/

// Course platforms and study surfaces recognizable from a window/tab title when
// no domain signal is available (e.g. a browser whose tab cannot be read).
const LEARNING_TITLE_RE =
  /\b(coursera|udemy|khan academy|edx|datacamp|pluralsight|codecademy|freecodecamp|brilliant\.org|udacity|skillshare)\b/

/** The hold kind this session earns through a no-input stretch, or null when
 *  ordinary idle handling applies. */
export function passivePresenceHoldKind(session: PassivePresenceInput): PassiveHoldKind | null {
  if (session.passiveHold) return session.passiveHold
  if (session.category === 'entertainment' || session.category === 'meetings') return 'media'
  const haystack = `${session.bundleId} ${session.appName} ${session.rawAppName} ${session.windowTitle ?? ''}`.toLowerCase()
  if (PASSIVE_MEDIA_RE.test(haystack) || LIVE_CALL_OR_CLASS_RE.test(haystack)) return 'media'
  // The bare boolean predates hold kinds and always meant the media behavior.
  if (session.passivePresence) return 'media'
  if (LEARNING_TITLE_RE.test(haystack)) return 'reading'
  return null
}

/** True when the session is presence (watching/attending/studying), so a
 *  no-input idle stretch should hold it open rather than flush it as away. */
export function looksLikePassivePresenceSession(session: PassivePresenceInput): boolean {
  return passivePresenceHoldKind(session) !== null
}
