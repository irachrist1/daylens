import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

test('billing backend stores usage metadata, not prompts or answers', () => {
  const schema = fs.readFileSync(path.join(root, 'services/billing/schema.sql'), 'utf8')
  const usageTable = schema.match(/CREATE TABLE IF NOT EXISTS billing_usage \(([\s\S]*?)\);/)?.[1] ?? ''
  assert.match(schema, /installation_hash TEXT NOT NULL UNIQUE/)
  assert.match(usageTable, /input_tokens BIGINT/)
  assert.match(usageTable, /cost_micros BIGINT NOT NULL/)
  assert.doesNotMatch(usageTable, /\b(prompt|answer|content|message)\b/i)
})

test('LiteLLM is configured not to retain message content', () => {
  const config = fs.readFileSync(path.join(root, 'services/billing/litellm-config.yaml'), 'utf8')
  assert.match(config, /turn_off_message_logging:\s*true/)
  assert.match(config, /redact_user_api_key_info:\s*true/)
})

test('billing service source is valid JavaScript and includes both Rwanda payment rails', () => {
  const serverPath = path.join(root, 'services/billing/src/server.mjs')
  const checked = spawnSync(process.execPath, ['--check', serverPath], { encoding: 'utf8' })
  assert.equal(checked.status, 0, checked.stderr)
  const source = fs.readFileSync(serverPath, 'utf8')
  assert.match(source, /api\.polar\.sh/)
  assert.match(source, /api\.flutterwave\.com/)
  assert.match(source, /payment_options:\s*'mobilemoneyrwanda'/)
})

test('desktop keeps own-key access ahead of managed access', () => {
  const source = fs.readFileSync(path.join(root, 'src/main/services/billing.ts'), 'utf8')
  const ownKeyCheck = source.indexOf('selectedOwnKeyProvider')
  const managedSession = source.indexOf("'/v1/ai/session'")
  assert.ok(ownKeyCheck >= 0)
  assert.ok(managedSession > ownKeyCheck)
  assert.match(source, /Calls go straight to your provider/)
})
