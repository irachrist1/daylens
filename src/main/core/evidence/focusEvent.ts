export const FOCUS_EVENT_SCHEMA_VERSION = 1 as const

export const FOCUS_EVENT_TYPES = [
  'app_activated',
  'app_deactivated',
  'window_changed',
  'space_changed',
  'sleep',
  'wake',
  'lock',
  'unlock',
  'tab_changed',
  'tab_sampled',
] as const

export const FOCUS_EVENT_CONFIDENCES = ['observed', 'unknown'] as const
export const MAC_FOCUS_EVENT_SOURCES = ['nsworkspace_event', 'apple_events_tab'] as const
export const WINDOWS_FOCUS_EVENT_SOURCES = ['uia_foreground', 'uia_tab'] as const

export type FocusEventType = typeof FOCUS_EVENT_TYPES[number]
export type FocusEventConfidence = typeof FOCUS_EVENT_CONFIDENCES[number]
export type MacFocusEventSource = typeof MAC_FOCUS_EVENT_SOURCES[number]
export type WindowsFocusEventSource = typeof WINDOWS_FOCUS_EVENT_SOURCES[number]
export type FocusEventSource = MacFocusEventSource | WindowsFocusEventSource

const FOCUS_EVENT_TYPE_SET = new Set<string>(FOCUS_EVENT_TYPES)
const FOCUS_EVENT_CONFIDENCE_SET = new Set<string>(FOCUS_EVENT_CONFIDENCES)
const MAC_FOCUS_EVENT_SOURCE_SET = new Set<string>(MAC_FOCUS_EVENT_SOURCES)
const WINDOWS_FOCUS_EVENT_SOURCE_SET = new Set<string>(WINDOWS_FOCUS_EVENT_SOURCES)
const TAB_EVENT_TYPES = new Set<FocusEventType>(['tab_changed', 'tab_sampled'])

export interface FocusEvent<TSource extends FocusEventSource = FocusEventSource> {
  ts_ms: number
  mono_ns: number
  event_type: FocusEventType
  app_bundle_id: string | null
  app_name: string | null
  pid: number | null
  window_title: string | null
  url: string | null
  page_title: string | null
  source: TSource
  confidence: FocusEventConfidence
  platform: string
  schema_ver: typeof FOCUS_EVENT_SCHEMA_VERSION
}

export function isFocusEventType(value: unknown): value is FocusEventType {
  return typeof value === 'string' && FOCUS_EVENT_TYPE_SET.has(value)
}

export function isFocusEventConfidence(value: unknown): value is FocusEventConfidence {
  return typeof value === 'string' && FOCUS_EVENT_CONFIDENCE_SET.has(value)
}

export function isMacFocusEventSource(value: unknown): value is MacFocusEventSource {
  return typeof value === 'string' && MAC_FOCUS_EVENT_SOURCE_SET.has(value)
}

export function isWindowsFocusEventSource(value: unknown): value is WindowsFocusEventSource {
  return typeof value === 'string' && WINDOWS_FOCUS_EVENT_SOURCE_SET.has(value)
}

export function sourceAcceptsFocusEventType(source: FocusEventSource, eventType: FocusEventType): boolean {
  return source === 'apple_events_tab' || source === 'uia_tab'
    ? TAB_EVENT_TYPES.has(eventType)
    : !TAB_EVENT_TYPES.has(eventType)
}
