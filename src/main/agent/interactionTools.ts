// Interaction tools for the chat agent (ADR 0003): the clarifying question
// (options + free-text escape, resolved by the renderer over IPC or by the
// bench's scripted answerer) and real downloadable file artifacts (CSV, Excel,
// Markdown). Both take injected handlers so the IPC path and the terminal
// bench share this exact code (ai.md §4.3).
import { tool } from 'ai'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import type { AIMessageArtifact } from '@shared/types'

export interface AgentQuestion {
  question: string
  options: string[]
  allowFreeText: boolean
}

export interface InteractionDeps {
  /** Ask the user one clarifying question; resolves with their answer text. */
  askUser: (question: AgentQuestion) => Promise<string>
  /** Directory artifacts are written into. */
  artifactDir: string
  /** Collects artifacts produced this turn so the chat turn can persist them. */
  onArtifact: (artifact: AIMessageArtifact) => void
  signal?: AbortSignal
}

const CELL = z.union([z.string(), z.number(), z.null()])

function safeFilename(title: string, extension: string): string {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export'
  return `${base}-${randomUUID().slice(0, 8)}.${extension}`
}

async function writeXlsx(filePath: string, sheetName: string, columns: string[], rows: Array<Array<string | number | null>>): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || 'Export')
  sheet.columns = columns.map((header) => ({ header, key: header, width: Math.min(60, Math.max(12, header.length + 2)) }))
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) sheet.addRow(row)
  await workbook.xlsx.writeFile(filePath)
}

function toCsv(columns: string[], rows: Array<Array<string | number | null>>): string {
  const cell = (value: string | number | null): string => {
    const text = value == null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [columns.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\n')
}

export function buildInteractionTools(deps: InteractionDeps) {
  return {
    ask_user: tool({
      description: 'Ask the user ONE short clarifying question with 2-4 tappable options, only when the evidence genuinely underdetermines the answer (e.g. two plausible readings of a time or an ambiguous name). Never use it to make the user do your work. The answer comes back as text.',
      inputSchema: z.object({
        question: z.string().min(1).max(200),
        options: z.array(z.string().min(1).max(80)).min(2).max(4),
      }),
      execute: async ({ question, options }) => {
        if (deps.signal?.aborted) throw new Error('aborted')
        const answer = await deps.askUser({ question, options, allowFreeText: true })
        return { answer }
      },
    }),

    create_artifact: tool({
      description: 'Create a real downloadable file for the user. Use "xlsx" when they say Excel, "csv" for CSV, "markdown" for a document/report. For xlsx/csv pass columns + rows (every claim in them must come from tool results this conversation). For markdown pass content. Returns the saved file; mention it naturally in your answer — the UI renders the download.',
      inputSchema: z.object({
        title: z.string().min(1).max(80).describe('Human title, e.g. "YouTube July 2026"'),
        format: z.enum(['xlsx', 'csv', 'markdown']),
        columns: z.array(z.string()).max(20).optional().describe('Column headers (xlsx/csv)'),
        rows: z.array(z.array(CELL).max(20)).max(2000).optional().describe('Data rows (xlsx/csv)'),
        content: z.string().max(200_000).optional().describe('Markdown body (markdown format only)'),
      }),
      execute: async ({ title, format, columns, rows, content }) => {
        if (format === 'markdown') {
          if (!content?.trim()) return { found: false, reason: 'Markdown artifacts need content.' }
        } else if (!columns?.length || !rows?.length) {
          return { found: false, reason: `${format} artifacts need columns and rows.` }
        }
        await fs.mkdir(deps.artifactDir, { recursive: true })
        const extension = format === 'markdown' ? 'md' : format
        const filePath = path.join(deps.artifactDir, safeFilename(title, extension))
        if (format === 'xlsx') {
          await writeXlsx(filePath, title, columns!, rows!)
        } else if (format === 'csv') {
          await fs.writeFile(filePath, toCsv(columns!, rows!), 'utf8')
        } else {
          await fs.writeFile(filePath, `# ${title}\n\n${content}`, 'utf8')
        }
        const artifact: AIMessageArtifact = {
          id: randomUUID(),
          kind: format === 'markdown' ? 'report' : 'export',
          format: format === 'xlsx' ? 'xlsx' : format === 'csv' ? 'csv' : 'markdown',
          title,
          path: filePath,
          openTarget: { kind: 'local_path', value: filePath },
          createdAt: Date.now(),
        }
        deps.onArtifact(artifact)
        // Echo title + columns back so the answer can name them without the
        // grounding verifier reading its own headers as fabricated entities.
        return { found: true, savedTo: filePath, filename: path.basename(filePath), title, columns: columns ?? null, rowCount: rows?.length ?? null }
      },
    }),
  }
}
