/**
 * Archive extract/create for the Maestro agent, backed by the bundled `ouch` binary.
 *
 * Passwords are passed only through the child process environment. They must never be appended to
 * argv, which is visible to other local processes. ouch 0.8.2 also ignores passwords while creating
 * archives, so password-protected creation is refused instead of producing misleading plaintext.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** ouch is fast, but a huge archive on a slow disk is not. */
const TIMEOUT_MS = 180_000
/** Bound the observation handed back to the model. */
const MAX_OUTPUT_CHARS = 8_000

/**
 * Extensions `ouch` handles. Archives never enter the prompt directly, so they use a separate
 * attachment ceiling from the normal context-sized file gate.
 */
export const ARCHIVE_EXTS = new Set([
  'zip',
  '7z',
  'rar',
  'tar',
  'tgz',
  'gz',
  'xz',
  'bz2',
  'bz3',
  'zst',
  'lz4',
  'lzma',
  'lz',
  'sz',
  'br'
])

/** Archives are capped for disk/time safety, independently from the 25 MB prompt-content cap. */
export const MAX_ARCHIVE_ATTACHMENT_BYTES = 100 * 1024 * 1024 * 1024

export const isArchivePath = (path: string): boolean => {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return ARCHIVE_EXTS.has(ext)
}

export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly code: 'unavailable' | 'timeout' | 'failed' | 'refused'
  ) {
    super(message)
    this.name = 'ArchiveError'
  }
}

const appendBounded = (
  current: string,
  chunk: string
): { text: string; truncated: boolean } => {
  if (current.length >= MAX_OUTPUT_CHARS) return { text: current, truncated: true }
  const remaining = MAX_OUTPUT_CHARS - current.length
  return {
    text: current + chunk.slice(0, remaining),
    truncated: chunk.length > remaining
  }
}

const withTruncationMarker = (text: string, truncated: boolean): string =>
  truncated ? `${text}\n…[truncated]` : text

const bundledOuchPath = (): string | null => {
  // The pinned ouch release has no Linux asset. Packaging deliberately leaves the runtime absent.
  if (process.platform === 'linux') return null
  const executable = process.platform === 'win32' ? 'ouch.exe' : 'ouch'
  const path = app.isPackaged
    ? join(process.resourcesPath, 'maestro-tools', executable)
    : join(app.getAppPath(), 'build', 'maestro-tools', executable)
  return existsSync(path) ? path : null
}

/** Run ouch without exposing passwords through argv or the parent process environment. */
const runOuch = async (
  args: string[],
  options: { cwd?: string; password?: string } = {}
): Promise<string> => {
  const bin = bundledOuchPath()
  if (!bin) {
    const platformDetail =
      process.platform === 'linux' ? ' Archive support is unavailable on Linux builds.' : ''
    throw new ArchiveError(
      `The bundled archive tool is missing from this build, so archives cannot be opened or created.${platformDetail}`,
      'unavailable'
    )
  }

  const env = { ...process.env }
  if (options.password) env.OUCH_PASSWORD = options.password
  else delete env.OUCH_PASSWORD

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true
    })
    let out = ''
    let err = ''
    let outTruncated = false
    let errTruncated = false
    let settled = false

    const fail = (error: ArchiveError): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const timer = setTimeout(() => {
      child.kill()
      fail(
        new ArchiveError(
          `The archive operation took longer than ${TIMEOUT_MS / 1000}s and was stopped.`,
          'timeout'
        )
      )
    }, TIMEOUT_MS)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      const next = appendBounded(out, chunk)
      out = next.text
      outTruncated = outTruncated || next.truncated
    })
    child.stderr?.on('data', (chunk: string) => {
      const next = appendBounded(err, chunk)
      err = next.text
      errTruncated = errTruncated || next.truncated
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      fail(new ArchiveError(`Could not run the archive tool: ${error.message}`, 'unavailable'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      // ouch writes informational messages to stderr, so stderr alone is not a failure signal.
      if (code === 0) {
        const combined = [out.trim(), err.trim()].filter(Boolean).join('\n')
        resolve(
          withTruncationMarker(
            combined.slice(0, MAX_OUTPUT_CHARS),
            outTruncated || errTruncated || combined.length > MAX_OUTPUT_CHARS
          )
        )
        return
      }
      const errText = err.trim()
      const outText = out.trim()
      const detail = errText || outText || `the archive tool exited with code ${code}`
      const detailTruncated = errText ? errTruncated : outText ? outTruncated : false
      reject(
        new ArchiveError(
          withTruncationMarker(
            detail.slice(0, MAX_OUTPUT_CHARS),
            detailTruncated || detail.length > MAX_OUTPUT_CHARS
          ),
          'failed'
        )
      )
    })
  })
}

/** List an archive's entries without extracting. */
export const listArchive = async (archive: string, password?: string): Promise<string> =>
  await runOuch(['list', archive], { password })

/** Extract `archive` into `destDir`. */
export const extractArchive = async (
  archive: string,
  destDir: string,
  password?: string
): Promise<string> =>
  await runOuch(['decompress', archive, '-d', destDir, '-y'], { password })

/** Create `archive` from `inputs`; `cwd` anchors relative paths stored in the archive. */
export const createArchive = async (
  archive: string,
  inputs: string[],
  options: { cwd?: string; password?: string } = {}
): Promise<string> => {
  if (options.password) {
    throw new ArchiveError(
      'Creating a password-protected archive is not supported: the bundled tool silently ignores the password on create, ' +
        'which would produce an unencrypted archive. Create it without a password and say so.',
      'refused'
    )
  }
  if (!inputs.length) throw new ArchiveError('create_archive needs at least one input path.', 'failed')
  return await runOuch(['compress', ...inputs, archive, '-y'], { cwd: options.cwd })
}
