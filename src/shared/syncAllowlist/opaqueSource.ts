import { z } from 'zod'
import { ExactKeys, OPAQUE_SOURCE_REFERENCE_KEYS } from './keys'

// Spec shape for synced source references: evidence identifier, kind, and
// originating device only. Titles, URLs, and excerpts are never allowed.
export interface OpaqueSourceReference {
  evidenceId: string
  evidenceKind: string
  originatingDevice: string
}

const _exactOpaqueSourceKeys: ExactKeys<
  OpaqueSourceReference,
  typeof OPAQUE_SOURCE_REFERENCE_KEYS
> = OPAQUE_SOURCE_REFERENCE_KEYS
void _exactOpaqueSourceKeys

export const opaqueSourceReferenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceKind: z.string().min(1),
    originatingDevice: z.string().min(1),
  })
  .strict()
