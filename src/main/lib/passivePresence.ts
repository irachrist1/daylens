// Passive-presence detection: is the user present-but-passive (watching a video,
// sitting in a live call or an online class) rather than truly away?
//
// Daylens flushes a session as "away" after 5 minutes with no keyboard/mouse
// input. That is right for an abandoned desk, but wrong for a 2-hour Meet class
// or a long video: you are there, watching, just not typing. Those must be held
// open as present. A genuine walk-away still ends the session on screen sleep or
// lock, which are handled separately, so this only changes the no-input case.

import type { AppCategory } from '@shared/types'

export type PassivePresenceInput = {
  category: AppCategory
  bundleId: string
  appName: string
  rawAppName: string
  windowTitle: string | null
  passivePresence?: boolean
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

/** True when the session is presence (watching/attending), so a no-input idle
 *  stretch should hold it open rather than flush it as away. */
export function looksLikePassivePresenceSession(session: PassivePresenceInput): boolean {
  if (session.passivePresence) return true
  if (session.category === 'entertainment' || session.category === 'meetings') return true
  const haystack = `${session.bundleId} ${session.appName} ${session.rawAppName} ${session.windowTitle ?? ''}`.toLowerCase()
  return PASSIVE_MEDIA_RE.test(haystack) || LIVE_CALL_OR_CLASS_RE.test(haystack)
}
