#!/usr/bin/env node
// Bulk-import the Daylens Help Center articles into Intercom via the Articles API,
// so Fin has content to answer from without pasting ~30 articles by hand.
//
// It parses docs/intercom-help-center-articles.md (one article per `## ` heading,
// grouped under `# Collection:` headings), converts each body to HTML, creates the
// collections if missing, and creates each article. Articles are created as DRAFTS
// by default — review and publish in Intercom, then connect the Help Center as a
// Fin content source.
//
// Prerequisites:
//   - An Intercom access token with Articles + Help Center write scope. Put it in
//     services/billing/.env as INTERCOM_ACCESS_TOKEN=... (this script loads that
//     file automatically) or pass it inline.
//
// Usage:
//   node scripts/intercom-import-articles.mjs --dry-run     # parse + preview, no API calls
//   node scripts/intercom-import-articles.mjs               # create as drafts
//   node scripts/intercom-import-articles.mjs --publish     # create already published
//   INTERCOM_ACCESS_TOKEN=xxx node scripts/intercom-import-articles.mjs
//
// Options:
//   --dry-run        Parse and print what would be created; make no API calls.
//   --publish        Create articles in the "published" state instead of "draft".
//   --force          Create even if an article with the same title already exists.
//   --file <path>    Source markdown (default docs/intercom-help-center-articles.md).
//   --author <id>    Intercom admin id to author the articles (default: first admin).
//   --no-collections Create every article at the top level (skip collection handling).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// ── args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const dryRun = has('--dry-run')
const publish = has('--publish')
const force = has('--force')
const useCollections = !has('--no-collections')
const sourceFile = path.resolve(repoRoot, valueOf('--file', 'docs/intercom-help-center-articles.md'))

// ── load INTERCOM_ACCESS_TOKEN from services/billing/.env if not already set ────
function loadBillingEnv() {
  if (process.env.INTERCOM_ACCESS_TOKEN) return
  const envPath = path.join(repoRoot, 'services/billing/.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadBillingEnv()

const token = process.env.INTERCOM_ACCESS_TOKEN || ''
// REST base by region. US default; derive EU/AU from INTERCOM_API_BASE or override.
function restBase() {
  if (process.env.INTERCOM_REST_BASE) return process.env.INTERCOM_REST_BASE.replace(/\/+$/, '')
  const region = (process.env.INTERCOM_API_BASE || '').toLowerCase()
  if (region.includes('.eu.')) return 'https://api.eu.intercom.io'
  if (region.includes('.au.')) return 'https://api.au.intercom.io'
  return 'https://api.intercom.io'
}
const BASE = restBase()

// ── markdown parsing ────────────────────────────────────────────────────────────
function parseArticles(md) {
  const lines = md.split('\n')
  const articles = []
  let collection = null
  let current = null
  const flush = () => {
    if (current) {
      // Trim leading/trailing blank lines from the body.
      while (current.body.length && current.body[0].trim() === '') current.body.shift()
      while (current.body.length && current.body[current.body.length - 1].trim() === '') current.body.pop()
      articles.push(current)
      current = null
    }
  }
  for (const line of lines) {
    const collMatch = line.match(/^#\s+Collection:\s*(.+?)\s*$/)
    if (collMatch) { flush(); collection = collMatch[1].trim(); continue }
    if (/^#\s+/.test(line) && !/^##/.test(line)) { flush(); continue } // other H1 (title/intro) — skip
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    if (h2) { flush(); current = { title: h2[1].trim(), collection, body: [] }; continue }
    if (line.trim() === '---') continue
    // The italic "*Collection: X*" hint line belongs to metadata, not the body.
    const inlineColl = line.match(/^\*Collection:\s*(.+?)\*\s*$/)
    if (inlineColl) { if (current && !current.collection) current.collection = inlineColl[1].trim(); continue }
    if (current) current.body.push(line)
  }
  flush()
  return articles.filter((a) => a.body.join('').trim().length > 0)
}

// ── minimal markdown → HTML (covers what the articles use) ──────────────────────
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
}
function bodyToHtml(bodyLines) {
  const blocks = []
  let buf = []
  const endBlock = () => { if (buf.length) { blocks.push(buf); buf = [] } }
  for (const line of bodyLines) {
    if (line.trim() === '') endBlock()
    else buf.push(line)
  }
  endBlock()

  // Group a list block into items, folding wrapped continuation lines (indented,
  // no marker) into the item above them.
  const toItems = (block, marker) => {
    const items = []
    for (const line of block) {
      if (marker.test(line)) items.push(line.replace(marker, ''))
      else if (items.length) items[items.length - 1] += ' ' + line.trim()
    }
    return items.map((it) => `<li>${inline(it.trim())}</li>`).join('')
  }

  const html = []
  for (const block of blocks) {
    // A block is a list if its FIRST line opens one; continuation lines wrap.
    if (/^\s*-\s+/.test(block[0])) {
      html.push('<ul>' + toItems(block, /^\s*-\s+/) + '</ul>')
    } else if (/^\s*\d+\.\s+/.test(block[0])) {
      html.push('<ol>' + toItems(block, /^\s*\d+\.\s+/) + '</ol>')
    } else {
      html.push('<p>' + inline(block.join(' ')) + '</p>')
    }
  }
  return html.join('\n')
}

// ── Intercom API ────────────────────────────────────────────────────────────────
async function api(method, endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}: ${json?.errors?.[0]?.message || text}`)
  return json
}

async function firstAdminId() {
  const provided = valueOf('--author', process.env.INTERCOM_AUTHOR_ID)
  if (provided) return provided
  const { admins } = await api('GET', '/admins')
  const admin = (admins || []).find((a) => a.type === 'admin') || (admins || [])[0]
  if (!admin) throw new Error('No admin found on this workspace to author the articles (pass --author <id>).')
  return admin.id
}

async function ensureCollections(names) {
  const map = new Map()
  if (!useCollections) return map
  let existing = []
  try {
    const res = await api('GET', '/help_center/collections?per_page=250')
    existing = res.data || []
  } catch (e) {
    console.warn('  (could not list collections, creating articles at top level):', e.message)
    return map
  }
  for (const name of names) {
    const found = existing.find((c) => (c.name || '').toLowerCase() === name.toLowerCase())
    if (found) { map.set(name, found.id); continue }
    try {
      const created = await api('POST', '/help_center/collections', { name })
      map.set(name, created.id)
      console.log(`  + collection "${name}" (${created.id})`)
    } catch (e) {
      console.warn(`  (could not create collection "${name}"):`, e.message)
    }
  }
  return map
}

async function existingTitles() {
  const titles = new Set()
  try {
    const res = await api('GET', '/articles?per_page=250')
    for (const a of res.data || []) titles.add((a.title || '').trim())
  } catch { /* fresh workspace or no access — treat as none */ }
  return titles
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(sourceFile)) throw new Error(`Source file not found: ${sourceFile}`)
  const articles = parseArticles(fs.readFileSync(sourceFile, 'utf8'))
  console.log(`Parsed ${articles.length} articles from ${path.relative(repoRoot, sourceFile)}`)

  if (dryRun) {
    for (const a of articles) {
      console.log(`\n── [${a.collection || 'no collection'}] ${a.title}`)
      console.log(bodyToHtml(a.body).slice(0, 240).replace(/\n/g, ' ') + '…')
    }
    console.log(`\nDry run — no API calls. Remove --dry-run to import into ${BASE}.`)
    return
  }

  if (!token) throw new Error('INTERCOM_ACCESS_TOKEN is not set (add it to services/billing/.env or pass it inline).')

  const authorId = await firstAdminId()
  console.log(`Author (admin) id: ${authorId}`)

  const collectionNames = [...new Set(articles.map((a) => a.collection).filter(Boolean))]
  const collections = await ensureCollections(collectionNames)

  const already = force ? new Set() : await existingTitles()
  let created = 0, skipped = 0

  for (const a of articles) {
    if (already.has(a.title)) { console.log(`  = skip (exists): ${a.title}`); skipped++; continue }
    const payload = {
      title: a.title,
      body: bodyToHtml(a.body),
      author_id: authorId,
      state: publish ? 'published' : 'draft',
    }
    const parentId = a.collection && collections.get(a.collection)
    if (parentId) { payload.parent_id = parentId; payload.parent_type = 'collection' }
    try {
      const res = await api('POST', '/articles', payload)
      console.log(`  + ${payload.state}: ${a.title}${parentId ? ` → ${a.collection}` : ''} (${res.id})`)
      created++
    } catch (e) {
      console.error(`  ! failed: ${a.title}: ${e.message}`)
    }
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped}. ${publish ? '' : 'Articles are DRAFTS — review and publish in Intercom, '}then connect the Help Center as a Fin content source.`)
}

main().catch((e) => { console.error('\nError:', e.message); process.exit(1) })
