// Arms the billing "vite defines" for tests/brutalDay.test.ts BEFORE any
// module that captures them evaluates. The ts-loader emits each define as
// `const X = globalThis.X !== undefined ? globalThis.X : <default>` at module
// top, so the override must exist before src/main/services/billing.ts is
// first evaluated — this module is imported FIRST for exactly that reason.
import { generateKeyPairSync } from 'node:crypto'

export const { privateKey, publicKey } = generateKeyPairSync('ed25519')
export const KID = 'brutal-day-1'
export const RAW_PUBLIC = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')

;(globalThis as Record<string, unknown>).__DAYLENS_BILLING_API_URL__ = 'https://billing.brutal.test'
;(globalThis as Record<string, unknown>).__DAYLENS_ENTITLEMENT_PUBLIC_KEYS__ = JSON.stringify({ [KID]: RAW_PUBLIC })
