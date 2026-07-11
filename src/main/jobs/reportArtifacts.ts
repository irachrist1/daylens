// Report artifact generation — the code that turns report markdown and
// structured rows into downloadable files (PDF, Word, HTML, Markdown, CSV,
// chart HTML) and writes them into userData/generated-reports. Extracted from
// aiService.ts so the chat/orchestration file no longer carries document
// rendering. Markdown parsing is shared with the renderer via @shared/markdown.
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseInlineMarkdown, parseMarkdownBlocks, type MarkdownBlockNode } from '@shared/markdown'
import type { AIMessageArtifact } from '@shared/types'
import type { ReportExportFormat } from '../lib/reportFormats'

export interface ReportArtifactSpec {
  kind: AIMessageArtifact['kind']
  title: string
  format: AIMessageArtifact['format']
  /** Text for markdown/csv/html/json; a Buffer for binary formats (pdf/docx). */
  contents: string | Uint8Array
  subtitle?: string | null
  extension: string
}

function sanitizeFileStem(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.slice(0, 80) || 'daylens-report'
}

function csvCell(value: string | number): string {
  const raw = String(value ?? '')
  if (!/[",\n]/.test(raw)) return raw
  return `"${raw.replace(/"/g, '""')}"`
}

export function buildCsvContent(columns: string[], rows: Array<Record<string, string | number>>): string {
  const header = columns.map(csvCell).join(',')
  const body = rows.map((row) => columns.map((column) => csvCell(row[column] ?? '')).join(','))
  return [header, ...body].join('\n')
}

export function buildBarChartHtml(
  title: string,
  subtitle: string,
  valueLabel: string,
  rows: Array<{ label: string; value: number; secondaryValue?: number | null }>,
): string {
  const maxValue = Math.max(1, ...rows.map((row) => row.value))
  const safeRows = rows.slice(0, 12).map((row) => {
    const value = Math.max(0, Number(row.value) || 0)
    const secondaryValue = row.secondaryValue == null ? null : Math.max(0, Number(row.secondaryValue) || 0)
    return {
      label: row.label,
      value,
      secondaryValue,
      widthPct: Math.max(6, Math.round((value / maxValue) * 100)),
      secondaryPct: secondaryValue == null ? null : Math.max(4, Math.round((secondaryValue / maxValue) * 100)),
    }
  })

  const rowMarkup = safeRows.map((row) => `
    <div class="row">
      <div class="label">${row.label}</div>
      <div class="bar-wrap">
        <div class="bar primary" style="width:${row.widthPct}%"></div>
        ${row.secondaryPct == null ? '' : `<div class="bar secondary" style="width:${row.secondaryPct}%"></div>`}
      </div>
      <div class="value">${row.value.toFixed(1)} ${valueLabel}</div>
    </div>
  `).join('\n')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f7f4;
        --surface: #ffffff;
        --text: #171717;
        --muted: #5f5f55;
        --primary: #275efe;
        --secondary: #5ac8a8;
        --border: rgba(23, 23, 23, 0.08);
      }
      body {
        margin: 0;
        font-family: "Segoe UI", "SF Pro Text", "Helvetica Neue", sans-serif;
        background: linear-gradient(180deg, #f9f8f2 0%, var(--bg) 100%);
        color: var(--text);
      }
      main {
        max-width: 900px;
        margin: 0 auto;
        padding: 32px 24px 40px;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .chart {
        margin-top: 24px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px 18px 8px;
        box-shadow: 0 20px 40px rgba(23, 23, 23, 0.06);
      }
      .row {
        display: grid;
        grid-template-columns: 150px minmax(0, 1fr) 90px;
        gap: 14px;
        align-items: center;
        margin-bottom: 14px;
      }
      .label, .value {
        font-size: 13px;
      }
      .bar-wrap {
        position: relative;
        height: 22px;
        border-radius: 999px;
        background: #eceae0;
        overflow: hidden;
      }
      .bar {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        border-radius: 999px;
      }
      .primary {
        background: linear-gradient(90deg, #4b7aff 0%, var(--primary) 100%);
      }
      .secondary {
        background: rgba(90, 200, 168, 0.72);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${subtitle}</p>
      <section class="chart">
        ${rowMarkup || '<p>No chartable data was available for this request.</p>'}
      </section>
    </main>
  </body>
</html>`
}

async function ensureGeneratedReportsDir(): Promise<string> {
  const baseDir = app?.getPath?.('userData') ?? os.tmpdir()
  const reportDir = path.join(baseDir, 'generated-reports')
  await fs.mkdir(reportDir, { recursive: true })
  return reportDir
}

// DEV-90: "Generate a report" exports a real document, not markdown. We render
// the report's markdown into clean HTML and let Electron's native printToPDF
// turn it into a PDF — no third-party dependency, opens in any viewer.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inlineMarkdownToHtml(text: string): string {
  return parseInlineMarkdown(text).map((token) => {
    const safe = escapeHtml(token.text)
    switch (token.type) {
      case 'strong': return `<strong>${safe}</strong>`
      case 'em': return `<em>${safe}</em>`
      case 'code': return `<code>${safe}</code>`
      default: return safe
    }
  }).join('')
}

function blockNodeToHtml(node: MarkdownBlockNode): string {
  switch (node.type) {
    case 'table':
      return '<table><thead><tr>' + node.headers.map((h) => `<th>${inlineMarkdownToHtml(h)}</th>`).join('') + '</tr></thead><tbody>'
        + node.rows.map((r) => '<tr>' + r.map((c) => `<td>${inlineMarkdownToHtml(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>'
    case 'heading':
      return `<h${node.level}>${inlineMarkdownToHtml(node.text)}</h${node.level}>`
    case 'bullet_list':
      return '<ul>' + node.items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join('') + '</ul>'
    case 'ordered_list':
      return '<ol>' + node.items.map((item) => `<li>${inlineMarkdownToHtml(item.text)}</li>`).join('') + '</ol>'
    case 'paragraph':
      return '<p>' + node.lines.map((line) => inlineMarkdownToHtml(line)).join('<br/>') + '</p>'
  }
}

export function reportMarkdownToHtml(markdown: string): string {
  return parseMarkdownBlocks(markdown).map(blockNodeToHtml).join('\n')
}

// Don't repeat the title as a subtitle (or in the footer) — that printed the
// report date twice when callers passed the same string for both.
function subtitleIfDistinct(title: string, subtitle: string): string | null {
  const trimmed = subtitle.trim()
  return trimmed.length > 0 && trimmed !== title.trim() ? subtitle : null
}

export function buildReportHtml(title: string, subtitle: string, markdown: string): string {
  const shownSubtitle = subtitleIfDistinct(title, subtitle)
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1a1c20; margin: 0; padding: 48px 56px; font-size: 13px; line-height: 1.6; }
    h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
    h2 { font-size: 17px; margin: 24px 0 8px; }
    h3 { font-size: 14px; margin: 18px 0 6px; }
    .subtitle { color: #6b7280; font-size: 12px; margin: 0 0 24px; }
    p { margin: 0 0 10px; }
    ul, ol { margin: 0 0 12px; padding-left: 22px; }
    li { margin: 2px 0; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 12px; }
    th { text-align: left; text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 6px 10px; background: #f9fafb; }
    td { padding: 6px 10px; border-bottom: 1px solid #f0f1f3; vertical-align: top; }
    td:first-child { font-weight: 600; }
    code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; font-size: 11px; }
    footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 11px; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    ${shownSubtitle ? `<p class="subtitle">${escapeHtml(shownSubtitle)}</p>` : ''}
    ${reportMarkdownToHtml(markdown)}
    <footer>Generated by Daylens${shownSubtitle ? ` for ${escapeHtml(shownSubtitle)}` : ''}.</footer>
  </body></html>`
}

export async function renderReportPdf(title: string, subtitle: string, markdown: string): Promise<Buffer> {
  const html = buildReportHtml(title, subtitle, markdown)
  const win = new BrowserWindow({
    show: false,
    width: 820,
    height: 1100,
    webPreferences: { offscreen: true, sandbox: false, javascript: false },
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
    })
    return pdf
  } finally {
    win.destroy()
  }
}

// A real, editable Word document with zero dependencies. Word opens an HTML file
// carrying the Office namespaces as a fully editable .doc — the same no-extra-dep
// philosophy as our PDF (Electron printToPDF). Saved with a .doc extension.
function renderReportDocx(title: string, subtitle: string, markdown: string): string {
  const shownSubtitle = subtitleIfDistinct(title, subtitle)
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/>
  <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
  <style>
    @page { margin: 1in; }
    body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #1a1c20; font-size: 11pt; line-height: 1.5; }
    h1 { font-size: 20pt; margin: 0 0 4pt; }
    h2 { font-size: 14pt; margin: 16pt 0 6pt; }
    h3 { font-size: 12pt; margin: 12pt 0 4pt; }
    .subtitle { color: #6b7280; font-size: 10pt; margin: 0 0 16pt; }
    table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
    th, td { border: 1px solid #d1d5db; padding: 5pt 8pt; text-align: left; font-size: 10pt; }
    th { background: #f3f4f6; }
    p { margin: 0 0 8pt; }
    ul, ol { margin: 0 0 8pt 0; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    ${shownSubtitle ? `<p class="subtitle">${escapeHtml(shownSubtitle)}</p>` : ''}
    ${reportMarkdownToHtml(markdown)}
  </body></html>`
}

// One report, any format. The single place that turns report markdown into a
// downloadable artifact — so every path (fresh generation, transform, re-export)
// produces identical files and they can never drift.
export async function buildReportArtifact(
  format: ReportExportFormat,
  reportTitle: string,
  subtitle: string,
  reportMarkdown: string,
): Promise<ReportArtifactSpec> {
  const base = { kind: 'report' as const, title: 'shareable-report', subtitle }
  switch (format) {
    case 'pdf':
      return { ...base, format: 'pdf', extension: 'pdf', contents: await renderReportPdf(reportTitle, subtitle, reportMarkdown) }
    case 'docx':
      return { ...base, format: 'docx', extension: 'doc', contents: renderReportDocx(reportTitle, subtitle, reportMarkdown) }
    case 'html':
      return { ...base, format: 'html', extension: 'html', contents: buildReportHtml(reportTitle, subtitle, reportMarkdown) }
    case 'markdown':
      return { ...base, format: 'markdown', extension: 'md', contents: `# ${reportTitle}\n\n${reportMarkdown}` }
  }
}

export async function writeGeneratedArtifacts(
  title: string,
  artifacts: ReportArtifactSpec[],
): Promise<AIMessageArtifact[]> {
  const outputDir = await ensureGeneratedReportsDir()
  const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '')
  const stem = sanitizeFileStem(title)
  const written: AIMessageArtifact[] = []

  for (const artifact of artifacts) {
    const fileName = `${stamp}-${stem}-${sanitizeFileStem(artifact.title)}.${artifact.extension}`
    const filePath = path.join(outputDir, fileName)
    if (typeof artifact.contents === 'string') {
      await fs.writeFile(filePath, artifact.contents, 'utf8')
    } else {
      await fs.writeFile(filePath, artifact.contents)
    }
    written.push({
      id: `${stamp}:${artifact.kind}:${artifact.format}:${artifact.title}`,
      kind: artifact.kind,
      title: artifact.title,
      subtitle: artifact.subtitle ?? null,
      format: artifact.format,
      path: filePath,
      openTarget: { kind: 'local_path', value: filePath },
      createdAt: Date.now(),
    })
  }

  return written
}
