import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FOCUS_EVENT_SCHEMA_VERSION,
  isFocusEventConfidence,
  isFocusEventType,
  isMacFocusEventSource,
  isWindowsFocusEventSource,
  sourceAcceptsFocusEventType,
} from '../src/main/core/evidence/focusEvent.ts'

test('focus event contract identifies platform sources and schema values', () => {
  assert.equal(FOCUS_EVENT_SCHEMA_VERSION, 1)
  assert.equal(isFocusEventType('window_changed'), true)
  assert.equal(isFocusEventType('unknown_event'), false)
  assert.equal(isFocusEventConfidence('observed'), true)
  assert.equal(isFocusEventConfidence('inferred'), false)
  assert.equal(isMacFocusEventSource('nsworkspace_event'), true)
  assert.equal(isMacFocusEventSource('uia_foreground'), false)
  assert.equal(isWindowsFocusEventSource('uia_tab'), true)
  assert.equal(isWindowsFocusEventSource('apple_events_tab'), false)
})

test('focus event contract keeps foreground and tab events on compatible sources', () => {
  assert.equal(sourceAcceptsFocusEventType('nsworkspace_event', 'app_activated'), true)
  assert.equal(sourceAcceptsFocusEventType('nsworkspace_event', 'tab_changed'), false)
  assert.equal(sourceAcceptsFocusEventType('uia_foreground', 'window_changed'), true)
  assert.equal(sourceAcceptsFocusEventType('uia_foreground', 'tab_sampled'), false)
  assert.equal(sourceAcceptsFocusEventType('apple_events_tab', 'tab_changed'), true)
  assert.equal(sourceAcceptsFocusEventType('apple_events_tab', 'window_changed'), false)
  assert.equal(sourceAcceptsFocusEventType('uia_tab', 'tab_sampled'), true)
  assert.equal(sourceAcceptsFocusEventType('uia_tab', 'app_deactivated'), false)
})
