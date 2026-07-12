// Wrapped export — turns a slide deck into shareable PNGs.
//
// Two layers, split for testability:
//  1. `buildWrapExportModels` — PURE: deck specs + resolved lines → flat draw
//     models. No DOM. Unit-testable with real facts.
//  2. `renderWrapExport` / `saveWrapExport` — canvas rendering with injectable
//     canvas/save deps, so tests can verify a file is produced without a DOM.
//
// The finale's Export button renders EVERY slide into one tall 1080-wide image
// (one 1080×1350 panel per slide) — the whole story in a single graphic, clean
// enough to post. Individual slides still save as single panels.

import type { WrapDeckMeta, WrapSlideSpec } from '../../lib/wrapDeck'
import { formatHm, resolveSlideLine } from '../../lib/wrapDeck'
import { slideGradient } from './wrapKit'

export const EXPORT_PANEL_W = 1080
export const EXPORT_PANEL_H = 1350

export interface WrapExportRow { name: string; value: string; pct: number }

export interface WrapExportSlideModel {
  id: string
  kicker: string
  /** The big reveal ("8h 59m", "6:12am", "4"). null on prose slides. */
  headline: string | null
  sublabel: string | null
  /** The slide's prose line (AI or fallback). */
  line: string
  rows: WrapExportRow[]
  gradient: [string, string, string]
  accent: string
}

/** Deck → flat draw models, deterministically. Pure. */
export function buildWrapExportModels(
  slides: WrapSlideSpec[],
  lines: Record<string, string | null> | null | undefined,
  extras: { question: string | null; reflection: string | null },
  meta: WrapDeckMeta,
  seed: number,
): WrapExportSlideModel[] {
  const models: WrapExportSlideModel[] = []
  slides.forEach((spec, index) => {
    const { gradient, accent } = slideGradient(seed, index)
    const base = { id: spec.id, kicker: spec.kicker, gradient, accent }
    if (spec.kind === 'question') {
      // The interactive slide exports as the question itself — a real moment.
      models.push({ ...base, headline: null, sublabel: null, line: extras.question ?? spec.fallbackLine, rows: [] })
      return
    }
    if (spec.kind === 'reflection') {
      models.push({ ...base, headline: null, sublabel: null, line: extras.reflection ?? spec.fallbackLine, rows: [] })
      return
    }
    if (spec.kind === 'coverage') {
      // The honesty card exports too: what the wrap saw and what it didn't.
      models.push({
        ...base,
        headline: null,
        sublabel: null,
        line: resolveSlideLine(spec, lines),
        rows: (spec.coverage?.sources ?? []).map((s) => ({ name: s.name, value: s.present ? 'seen' : 'no data', pct: s.present ? 100 : 0 })),
      })
      return
    }
    if (spec.kind === 'finale') {
      models.push({
        ...base,
        kicker: meta.rangeLabel,
        headline: meta.headline,
        sublabel: meta.footer,
        line: '',
        rows: [],
      })
      return
    }
    const rows: WrapExportRow[] = []
    if (spec.bars && spec.bars.length > 0) {
      const max = Math.max(...spec.bars.map((b) => b.seconds), 1)
      for (const bar of spec.bars.slice(0, 6)) {
        rows.push({ name: bar.name, value: formatHm(bar.seconds), pct: Math.round((bar.seconds / max) * 100) })
      }
    } else if (spec.buckets && spec.buckets.length > 0) {
      const max = Math.max(...spec.buckets.map((b) => b.seconds), 1)
      for (const bucket of spec.buckets.slice(0, 7)) {
        rows.push({ name: bucket.label, value: formatHm(bucket.seconds), pct: Math.round((bucket.seconds / max) * 100) })
      }
    } else if (spec.split) {
      rows.push({ name: spec.split.aLabel, value: `${formatHm(spec.split.aSeconds)} · ${spec.split.aPct}%`, pct: spec.split.aPct })
      rows.push({ name: spec.split.bLabel, value: `${formatHm(spec.split.bSeconds)} · ${spec.split.bPct}%`, pct: spec.split.bPct })
    } else if (spec.compare) {
      const max = Math.max(spec.compare.currentSeconds, spec.compare.previousSeconds, 1)
      rows.push({ name: spec.compare.currentLabel, value: formatHm(spec.compare.currentSeconds), pct: Math.round((spec.compare.currentSeconds / max) * 100) })
      rows.push({ name: spec.compare.previousLabel, value: formatHm(spec.compare.previousSeconds), pct: Math.round((spec.compare.previousSeconds / max) * 100) })
    }
    models.push({
      ...base,
      headline: spec.stat?.value ?? null,
      sublabel: spec.stat?.sublabel ?? null,
      line: resolveSlideLine(spec, lines),
      rows,
    })
  })
  return models
}

// ─── Canvas rendering (injectable for tests) ──────────────────────────────────

/** The 2D surface the renderer needs — a strict subset of CanvasRenderingContext2D
 *  so a recording stub can stand in during tests. */
export interface WrapExportCtx {
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void }
}

export interface WrapExportCanvas {
  width: number
  height: number
  getContext(type: '2d'): WrapExportCtx | null
}

export interface WrapExportDeps {
  createCanvas: (width: number, height: number) => WrapExportCanvas
  toBlob: (canvas: WrapExportCanvas) => Promise<Blob | null>
  save: (blob: Blob, filename: string) => Promise<void>
}

function domDeps(): WrapExportDeps {
  return {
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return canvas as unknown as WrapExportCanvas
    },
    toBlob: (canvas) =>
      new Promise<Blob | null>((resolve) =>
        (canvas as unknown as HTMLCanvasElement).toBlob((b) => resolve(b), 'image/png')),
    save: async (blob, filename) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      try {
        if (navigator.clipboard && 'write' in navigator.clipboard) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        }
      } catch { /* clipboard is best-effort */ }
    },
  }
}

const PAD = 96

/** Browsers cap canvas dimensions around 32k px. One column of 1350px panels
 *  blows past that at ~24 slides (a month deck), making toBlob return null and
 *  the export silently fail. Two columns keep a 30-slide deck at ~20k px. */
export const EXPORT_MAX_SINGLE_COLUMN = 12

export function exportGrid(count: number): { cols: number; rows: number } {
  const cols = count > EXPORT_MAX_SINGLE_COLUMN ? 2 : 1
  return { cols, rows: Math.ceil(count / cols) }
}

function drawPanel(ctx: WrapExportCtx, model: WrapExportSlideModel, left: number, top: number, footer: string): void {
  const W = EXPORT_PANEL_W
  const H = EXPORT_PANEL_H
  const bg = ctx.createLinearGradient(left, top, left + W, top + H)
  bg.addColorStop(0, model.gradient[0])
  bg.addColorStop(0.55, model.gradient[1])
  bg.addColorStop(1, model.gradient[2])
  ctx.fillStyle = bg
  ctx.fillRect(left, top, W, H)

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // Brand row.
  let y = top + 150
  ctx.fillStyle = model.accent
  ctx.font = '700 28px Inter, system-ui, sans-serif'
  ctx.fillText('DAYLENS', left + PAD, y)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '700 26px Inter, system-ui, sans-serif'
  ctx.fillText(model.kicker.toUpperCase().slice(0, 42), left + W - PAD, y)
  ctx.textAlign = 'left'

  y += 170

  if (model.headline) {
    ctx.fillStyle = '#ffffff'
    ctx.font = '900 132px Inter, system-ui, sans-serif'
    ctx.fillText(truncateToWidth(ctx, model.headline, W - PAD * 2), left + PAD, y)
    y += 56
    if (model.sublabel) {
      ctx.fillStyle = 'rgba(255,255,255,0.62)'
      ctx.font = '400 34px Inter, system-ui, sans-serif'
      ctx.fillText(truncateToWidth(ctx, model.sublabel, W - PAD * 2), left + PAD, y)
      y += 40
    }
    y += 60
  }

  if (model.line) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.font = '600 44px Inter, system-ui, sans-serif'
    for (const line of wrapText(ctx, model.line, W - PAD * 2).slice(0, 10)) {
      ctx.fillText(line, left + PAD, y)
      y += 62
    }
    y += 40
  }

  for (const row of model.rows) {
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 36px Inter, system-ui, sans-serif'
    ctx.fillText(truncateToWidth(ctx, row.name, W - PAD * 2 - 240), left + PAD, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '500 32px Inter, system-ui, sans-serif'
    ctx.fillText(row.value, left + W - PAD, y)
    ctx.textAlign = 'left'
    y += 26
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(left + PAD, y, W - PAD * 2, 10)
    ctx.fillStyle = model.accent
    ctx.fillRect(left + PAD, y, Math.max(10, Math.round((W - PAD * 2) * (row.pct / 100))), 10)
    y += 66
  }

  // Watermark footer.
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.font = '500 28px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(footer, left + W / 2, top + H - 84)
  ctx.textAlign = 'left'
}

/** Render the models into one canvas (a single panel is just N=1). Decks past
 *  EXPORT_MAX_SINGLE_COLUMN lay out in two columns, reading order left-right
 *  then down, to stay inside browser canvas limits. */
export async function renderWrapExport(
  models: WrapExportSlideModel[],
  footer: string,
  deps: WrapExportDeps,
): Promise<Blob | null> {
  if (models.length === 0) return null
  const { cols, rows } = exportGrid(models.length)
  const canvas = deps.createCanvas(EXPORT_PANEL_W * cols, EXPORT_PANEL_H * rows)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // A ragged last row leaves a transparent gap; paint the sheet black first.
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, EXPORT_PANEL_W * cols, EXPORT_PANEL_H * rows)
  models.forEach((model, i) => drawPanel(ctx, model, (i % cols) * EXPORT_PANEL_W, Math.floor(i / cols) * EXPORT_PANEL_H, footer))
  return deps.toBlob(canvas)
}

/** Render + save. Returns true when a file was actually produced; false when
 *  the canvas/encoder produced nothing (e.g. a null toBlob). A throwing save
 *  sink rejects, so callers can surface the failure — silence is never an
 *  outcome here. */
export async function saveWrapExport(
  models: WrapExportSlideModel[],
  filename: string,
  footer: string,
  deps: WrapExportDeps = domDeps(),
): Promise<boolean> {
  const blob = await renderWrapExport(models, footer, deps)
  if (!blob) return false
  await deps.save(blob, filename)
  return true
}

// ─── Export status labels (honest, voice.md §errors: one calm line, no sorry) ─
// Pure so the hermetic suite can pin that a failure is VISIBLE — the old UI
// mapped every failure back to the idle label and the user learned nothing.

export type WrapExportState = 'idle' | 'working' | 'done' | 'failed'

export function exportButtonLabel(state: WrapExportState): string {
  switch (state) {
    case 'working': return 'Exporting…'
    case 'done': return 'Exported ✓'
    case 'failed': return "Export didn't finish. Try again"
    default: return 'Export wrap'
  }
}

export type WrapSlideSaveState = 'idle' | 'saved' | 'failed'

export function saveSlideButtonLabel(state: WrapSlideSaveState): string {
  switch (state) {
    case 'saved': return 'Saved ✓'
    case 'failed': return "Save didn't finish. Try again"
    default: return 'Save slide'
  }
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function truncateToWidth(ctx: WrapExportCtx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}

function wrapText(ctx: WrapExportCtx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}
