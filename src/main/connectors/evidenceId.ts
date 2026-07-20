// Shared between ingest (writes) and purge (removes) without importing either.

import type { ConnectorId } from '@shared/types'

/** The evidence-ref source id every ingested record stamps on the entities it
 *  supports. Disconnect cleanup removes exactly these rows, so an entity's
 *  remaining support is always honest. */
export function connectorEvidenceSourceId(connectorId: ConnectorId, sourceRecordId: string): string {
  return `${connectorId}:${sourceRecordId}`
}
