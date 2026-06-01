import { Fragment } from 'react'
import { Calendar } from 'lucide-react'
import AppIcon from '../../components/AppIcon'
import { ipc } from '../../lib/ipc'
import { splitMentionSegments } from './mentionParse'

// FB11: @-mentions carry the entity's icon — in the dropdown, in the inserted
// composer chip, and in the sent message — like Notion/Raycast. App icons resolve
// through the same icon resolver the Timeline/Apps views use.

export type MentionKind = 'App' | 'Client' | 'Day'

export interface MentionItem {
  id: string
  label: string
  insert: string
  kind: MentionKind
  color?: string | null
}

function initials(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) return '·'
  const parts = trimmed.split(/\s+/)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : trimmed.slice(0, 2)).toUpperCase()
}

// ── Dropdown row icon (React) ───────────────────────────────────────────────
export function MentionRowIcon({ item, size = 18 }: { item: MentionItem; size?: number }) {
  if (item.kind === 'App') {
    return <AppIcon appName={item.label} size={size} fontSize={9} />
  }
  if (item.kind === 'Client') {
    return (
      <span style={{ width: size, height: size, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'var(--color-surface-high)' }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: item.color || 'var(--color-accent)' }} />
      </span>
    )
  }
  return (
    <span style={{ width: size, height: size, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'var(--color-surface-high)', color: 'var(--color-text-secondary)' }}>
      <Calendar size={Math.round(size * 0.62)} strokeWidth={1.9} aria-hidden="true" />
    </span>
  )
}

// ── Inserted composer chip (imperative DOM, lives inside the contenteditable) ─
const CALENDAR_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10.5" rx="2"/><path d="M2.5 6.5h11M5.5 1.8v2.4M10.5 1.8v2.4"/></svg>'

async function appIconNode(appName: string): Promise<Node> {
  try {
    const resolved = await ipc.icons.resolve({ kind: 'app', appName, appInstanceId: null, bundleId: null, canonicalAppId: null })
    if (resolved.dataUrl) {
      const img = document.createElement('img')
      img.src = resolved.dataUrl
      img.alt = ''
      return img
    }
  } catch { /* fall through to initials */ }
  const fallback = document.createElement('span')
  fallback.className = 'dl-mention-fallback'
  fallback.textContent = initials(appName)
  return fallback
}

/**
 * Build the non-editable chip element inserted into the contenteditable composer.
 * App icons are resolved asynchronously and swapped in when ready, so insertion
 * stays synchronous (no caret jump waiting on IO).
 */
export function buildMentionChipElement(item: MentionItem): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'dl-mention'
  span.contentEditable = 'false'
  // App/Client mentions keep an @ in the serialized text so the sent message can
  // re-chip them; Day mentions serialize to the plain temporal phrase the model needs.
  span.dataset.mentionInsert = item.kind === 'Day' ? item.insert : `@${item.label}`

  if (item.kind === 'App') {
    const placeholder = document.createElement('span')
    placeholder.className = 'dl-mention-fallback'
    placeholder.textContent = initials(item.label)
    span.appendChild(placeholder)
    void appIconNode(item.label).then((node) => { if (span.firstChild === placeholder) span.replaceChild(node, placeholder) })
  } else if (item.kind === 'Client') {
    const dot = document.createElement('span')
    dot.className = 'dl-mention-dot'
    dot.style.background = item.color || 'var(--color-accent)'
    span.appendChild(dot)
  } else {
    const wrap = document.createElement('span')
    wrap.style.display = 'inline-flex'
    wrap.style.color = 'var(--color-text-secondary)'
    wrap.innerHTML = CALENDAR_SVG
    span.appendChild(wrap.firstElementChild as Node)
  }

  span.appendChild(document.createTextNode(item.label))
  return span
}

// ── Sent-message rendering (React) ──────────────────────────────────────────
// Renders @Token mentions in a user message as inline chips (best-effort app
// icon resolution). Day phrases serialize without an @, so they stay plain text.
export function MentionText({ text }: { text: string }) {
  const segments = splitMentionSegments(text)
  return (
    <>
      {segments.map((segment, index) => (
        segment.type === 'text'
          ? <Fragment key={index}>{segment.value}</Fragment>
          : <SentMentionChip key={index} name={segment.name} />
      ))}
    </>
  )
}

function SentMentionChip({ name }: { name: string }) {
  return (
    <span className="dl-mention">
      <AppIcon appName={name} size={14} fontSize={8} cornerRadius={3} />
      {name}
    </span>
  )
}
