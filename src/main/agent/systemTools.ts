// Read-only machine tools for the chat agent (ADR 0003): file reads, directory
// listings, and an allowlisted read-only git surface ("what did I ship"). No
// write, edit, delete, or arbitrary shell — new capabilities are new tools.
import { tool } from 'ai'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const MAX_FILE_BYTES = 256 * 1024
const MAX_DIR_ENTRIES = 300
const MAX_GIT_OUTPUT = 64 * 1024
const GIT_TIMEOUT_MS = 15_000

// Read subcommands only. No config writes, no hooks, no fetch/push, and args
// that redirect output to files are rejected below.
const GIT_READ_SUBCOMMANDS = new Set(['log', 'show', 'diff', 'status', 'shortlog', 'branch', 'rev-parse', 'describe'])
const FORBIDDEN_GIT_ARG = /^(--output|--exec-path|--upload-pack|--receive-pack|-c$|--config)/

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  let suspicious = 0
  for (const byte of sample) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1
  }
  return sample.length > 0 && suspicious / sample.length > 0.1
}

export function buildSystemTools() {
  return {
    read_file: tool({
      description: 'Read a text file from this machine, read-only. Returns up to 256KB. Use absolute paths (the user\'s home is available in the environment note).',
      inputSchema: z.object({
        path: z.string().min(1).describe('Absolute file path'),
        offsetBytes: z.number().int().min(0).optional(),
      }),
      execute: async ({ path: filePath, offsetBytes }) => {
        if (!path.isAbsolute(filePath)) return { found: false, reason: 'Use an absolute path.' }
        try {
          const stat = await fs.stat(filePath)
          if (!stat.isFile()) return { found: false, reason: 'Not a regular file.' }
          const handle = await fs.open(filePath, 'r')
          try {
            const start = Math.min(offsetBytes ?? 0, stat.size)
            const length = Math.min(MAX_FILE_BYTES, stat.size - start)
            const buffer = Buffer.alloc(length)
            await handle.read(buffer, 0, length, start)
            if (looksBinary(buffer)) return { found: false, reason: 'Binary file — not readable as text.' }
            return {
              found: true,
              sizeBytes: stat.size,
              truncated: start + length < stat.size,
              content: buffer.toString('utf8'),
            }
          } finally {
            await handle.close()
          }
        } catch (error) {
          return { found: false, reason: error instanceof Error ? error.message : String(error) }
        }
      },
    }),

    list_dir: tool({
      description: 'List a directory on this machine, read-only: names, kinds, sizes.',
      inputSchema: z.object({ path: z.string().min(1).describe('Absolute directory path') }),
      execute: async ({ path: dirPath }) => {
        if (!path.isAbsolute(dirPath)) return { found: false, reason: 'Use an absolute path.' }
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true })
          const listed = await Promise.all(entries.slice(0, MAX_DIR_ENTRIES).map(async (entry) => {
            const kind = entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file'
            let sizeBytes: number | null = null
            if (kind === 'file') {
              try {
                sizeBytes = (await fs.stat(path.join(dirPath, entry.name))).size
              } catch {
                sizeBytes = null
              }
            }
            return { name: entry.name, kind, sizeBytes }
          }))
          return { found: true, truncated: entries.length > MAX_DIR_ENTRIES, entries: listed }
        } catch (error) {
          return { found: false, reason: error instanceof Error ? error.message : String(error) }
        }
      },
    }),

    git: tool({
      description: 'Read-only git against a local repository: log, show, diff, status, shortlog, branch, rev-parse, describe. Use for "what did I ship" — e.g. subcommand "log" with args ["--since=2026-07-01", "--oneline", "--author=..."]. Never mutates.',
      inputSchema: z.object({
        repoPath: z.string().min(1).describe('Absolute path to the repository'),
        subcommand: z.string().min(1).describe('One of: log, show, diff, status, shortlog, branch, rev-parse, describe'),
        args: z.array(z.string()).max(12).optional().describe('Extra arguments, e.g. ["--since=1 month ago", "--oneline"]'),
      }),
      execute: async ({ repoPath, subcommand, args }) => {
        if (!path.isAbsolute(repoPath)) return { found: false, reason: 'Use an absolute repo path.' }
        if (!GIT_READ_SUBCOMMANDS.has(subcommand)) {
          return { found: false, reason: `Subcommand "${subcommand}" is not on the read-only allowlist.` }
        }
        const extraArgs = args ?? []
        if (extraArgs.some((arg) => FORBIDDEN_GIT_ARG.test(arg))) {
          return { found: false, reason: 'An argument on the deny list was rejected.' }
        }
        try {
          const { stdout } = await execFileAsync(
            'git',
            ['-C', repoPath, '--no-pager', subcommand, ...extraArgs],
            { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_GIT_OUTPUT, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
          )
          const trimmed = stdout.length > MAX_GIT_OUTPUT ? `${stdout.slice(0, MAX_GIT_OUTPUT)}\n…(truncated)` : stdout
          return { found: true, output: trimmed }
        } catch (error) {
          return { found: false, reason: error instanceof Error ? error.message : String(error) }
        }
      },
    }),
  }
}
