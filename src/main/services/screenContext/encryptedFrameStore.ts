// Screen-context experiment (DEV-197) — encrypted at-rest storage for raw
// frames. AES-256-GCM per file (iv ‖ auth tag ‖ ciphertext); the key is
// injected so the harness can prove round-trips without any OS keychain, and
// production can source it from the secure store. Raw frames never leave this
// directory and never enter the database.

import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import type { FrameFileStore } from './types'

const IV_BYTES = 12
const TAG_BYTES = 16
const FRAME_FILE_SUFFIX = '.scframe'

export interface EncryptedFrameStoreOptions {
  /** Directory the encrypted frames live in (created if absent). */
  directory: string
  /** 32-byte AES-256 key. */
  key: Uint8Array
}

export function createEncryptedFrameStore(options: EncryptedFrameStoreOptions): FrameFileStore {
  if (options.key.length !== 32) {
    throw new Error('screen-context frame store requires a 32-byte key')
  }
  const dir = options.directory
  fs.mkdirSync(dir, { recursive: true })
  const key = Buffer.from(options.key)

  return {
    write(id: string, bytes: Uint8Array): { localPath: string; byteSize: number } {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()])
      const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
      // The filename is opaque — never derived from the frame's context.
      const fileName = `${randomUUID().replace(/-/g, '')}${FRAME_FILE_SUFFIX}`
      const localPath = path.join(dir, fileName)
      fs.writeFileSync(localPath, payload, { mode: 0o600 })
      void id
      return { localPath, byteSize: payload.byteLength }
    },

    read(localPath: string): Uint8Array {
      const payload = fs.readFileSync(localPath)
      if (payload.byteLength < IV_BYTES + TAG_BYTES) {
        throw new Error('screen-context frame file is truncated')
      }
      const iv = payload.subarray(0, IV_BYTES)
      const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
      const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()])
    },

    delete(localPath: string): void {
      fs.rmSync(localPath, { force: true })
    },

    list(): string[] {
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith(FRAME_FILE_SUFFIX))
        .map((name) => path.join(dir, name))
    },
  }
}
