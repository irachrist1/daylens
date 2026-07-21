#!/usr/bin/env node
// Mint an Ed25519 entitlement-signing keypair for the billing service.
//
// Prints:
//   • ENTITLEMENT_SIGNING_KEY / ENTITLEMENT_SIGNING_KID — set on the billing
//     service (Railway env). The private key never leaves the service.
//   • DAYLENS_ENTITLEMENT_PUBLIC_KEYS — set when building the desktop app so
//     the public key is pinned into the build and selected by kid.
//
// Rotation is kid-based: mint a new key with a NEW kid, ship the new public
// key in an app update (merge it into the existing DAYLENS_ENTITLEMENT_PUBLIC_KEYS
// JSON so old and new coexist), and only then switch the service to the new
// ENTITLEMENT_SIGNING_KEY / ENTITLEMENT_SIGNING_KID.
//
// Usage: node services/billing/scripts/generate-entitlement-key.mjs [kid]
import crypto from 'node:crypto'

const kid = process.argv[2] || `ent-${new Date().toISOString().slice(0, 10)}`
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

const privateDerBase64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
// The desktop pins the 32 raw public-key bytes; SPKI DER for Ed25519 is a
// fixed 12-byte prefix followed by exactly those 32 bytes.
const publicRawBase64 = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')

console.log('Billing service (keep secret):')
console.log(`  ENTITLEMENT_SIGNING_KID=${kid}`)
console.log(`  ENTITLEMENT_SIGNING_KEY=${privateDerBase64}`)
console.log('')
console.log('Desktop build (public, pinned):')
console.log(`  DAYLENS_ENTITLEMENT_PUBLIC_KEYS=${JSON.stringify({ [kid]: publicRawBase64 })}`)
