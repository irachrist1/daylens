// Normalization: one Granola note document → one shared connector record
// envelope (DEV-193). The entity is a meeting_record — occurrence evidence,
// not scheduled context: a Granola note is one of the spec's ways a calendar
// event becomes "you met". Content is minimized at the parser and stays
// minimized here: meeting identity, times, participants, and short note
// lines. Sensitivity is 'personal' throughout — notes are what was SAID in a
// meeting, and they follow the personal-content rules on every surface.

import type { ConnectorRecordEnvelope } from '../contract'
import type { GranolaNoteDoc } from './cache'

export const GRANOLA_CONNECTOR_ID = 'granola' as const
export const GRANOLA_SCOPE = 'file:read'

export interface GranolaNormalizeContext {
  retrievedAtMs: number
  accountLabel: string | null
}

export function granolaPersonConnectorId(participant: { email: string | null; name: string }): string {
  return participant.email
    ? `${GRANOLA_CONNECTOR_ID}:${participant.email}`
    : `${GRANOLA_CONNECTOR_ID}:name:${participant.name.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

function localDateOf(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

function localClockOf(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** Participant FIRST NAMES for the day layer — never emails, never surnames
 *  (the MeetingNoteSignal contract the wrap enrichment already sanitizes). */
function firstNameOf(participant: { email: string | null; name: string }): string | null {
  const source = participant.name.includes('@') ? participant.name.split('@')[0] : participant.name
  const first = source.trim().split(/[\s._]+/)[0]
  return first ? first : null
}

export function normalizeGranolaNote(
  doc: GranolaNoteDoc,
  context: GranolaNormalizeContext,
): ConnectorRecordEnvelope | null {
  if (!doc.id) return null
  const effectiveAtMs = doc.startMs ?? doc.createdAtMs ?? doc.updatedAtMs
  if (effectiveAtMs == null) return null

  const participants = doc.participants.map((participant) => ({
    connectorId: granolaPersonConnectorId(participant),
    displayName: participant.name,
  }))

  return {
    provenance: {
      connectorId: GRANOLA_CONNECTOR_ID,
      accountLabel: context.accountLabel,
      workspace: null,
      sourceRecordId: `note:${doc.id}`,
      retrievedAtMs: context.retrievedAtMs,
      effectiveAtMs,
      sensitivity: 'personal',
      permissionScope: GRANOLA_SCOPE,
    },
    entity: {
      kind: 'meeting_record',
      sourceEventId: `granola:${doc.id}`,
      title: doc.title,
      startMs: doc.startMs ?? effectiveAtMs,
      endMs: doc.endMs ?? undefined,
      participants,
      linkedCalendarEventIds: doc.calendarEventId ? [doc.calendarEventId] : undefined,
    },
    notesSignal: {
      date: localDateOf(effectiveAtMs),
      title: doc.title,
      participants: doc.participants
        .map(firstNameOf)
        .filter((name): name is string => name != null)
        .slice(0, 8),
      actionItems: doc.noteLines,
      scheduledClock: doc.startMs != null ? localClockOf(doc.startMs) : null,
    },
  }
}
