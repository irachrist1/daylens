// Screen-context experiment (DEV-197) — the production measurement sink.
// Maps the lifecycle's closed measurement vocabulary onto the PostHog event
// contract. Every property passes the global analytics sanitizer too, so even
// a future bug in the lifecycle's own filter cannot leak free text.

import { ANALYTICS_EVENT, type AnalyticsEventName } from '@shared/analytics'
import { capture } from '../analytics'
import type { ScreenContextMeasure, ScreenContextMeasureEvent } from './lifecycle'

const EVENT_MAP: Record<ScreenContextMeasureEvent, AnalyticsEventName> = {
  screen_context_consent: ANALYTICS_EVENT.SCREEN_CONTEXT_CONSENT,
  screen_context_capture: ANALYTICS_EVENT.SCREEN_CONTEXT_CAPTURE,
  screen_context_extraction: ANALYTICS_EVENT.SCREEN_CONTEXT_EXTRACTION,
  screen_context_backlog: ANALYTICS_EVENT.SCREEN_CONTEXT_BACKLOG,
}

export const productionScreenContextMeasure: ScreenContextMeasure = (event, props) => {
  capture(EVENT_MAP[event], props as Record<string, unknown>)
}
