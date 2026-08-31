/**
 * Main-side wrapper for the staged anydoc CLI bundle.
 *
 * The CLI runs through Electron's executable in Node mode. Its native binding and JavaScript
 * bundle are staged together under maestro-tools/anydoc, matching the bundled-tool pattern used
 * by the other platform executables. stdout/stderr are continuously drained and bounded.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const TIMEOUT_MS = 30_000
const MAX_STDERR_CHARS = 8_000

export class AnydocError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'needsOcr'
      | 'convert-failed'
      | 'usage'
      | 'timeout'
      | 'unavailable'
      | 'failed'
  ) {
    super(message)
    this.name = 'AnydocError'
  }
}

const anydocToolRoot = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'maestro-tools', 'anydoc')
    : join(app.getAppPath(), 'build', 'maestro-tools', 'anydoc')

const appendBounded = (
  current: string,
  chunk: string,
  maxChars: number
): { text: string; truncated: boolean } => {
  if (current.length >= maxChars) return { text: current, truncated: true }
  const remaining = maxChars - current.length
  return {
    text: current + chunk.slice(0, remaining),
    truncated: chunk.length > remaining
  }
}

export const anydocToMarkdown = async (
  path: string,
  options: { maxChars: number }
): Promise<{ text: string; truncated: boolean }> => {
  const root = anydocToolRoot()
  const cliPath = join(root, 'cli.js')
  const nativePath = join(root, 'anydoc.node')
  if (!existsSync(cliPath) || !existsSync(nativePath)) {
    throw new AnydocError(
      'The bundled document converter is missing from this build.',
      'unavailable'
    )
  }

  const maxChars = Math.max(1, Math.floor(options.maxChars))
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NAPI_RS_NATIVE_LIBRARY_PATH: nativePath
  }

  return await new Promise<{ text: string; truncated: boolean }>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, path], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let settled = false

    const fail = (error: AnydocError): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const timer = setTimeout(() => {
      child.kill()
      fail(
        new AnydocError(
          `Converting this document took longer than ${TIMEOUT_MS / 1000}s and was stopped.`,
          'timeout'
        )
      )
    }, TIMEOUT_MS)

    child.stdout?.on('data', (chunk: string) => {
      const next = appendBounded(stdout, chunk, maxChars)
      stdout = next.text
      stdoutTruncated = stdoutTruncated || next.truncated
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk, MAX_STDERR_CHARS).text
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      fail(new AnydocError(`Could not run the document converter: ${error.message}`, 'unavailable'))
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      const errorText = stderr.trim()
      if (exitCode === 0) {
        const text = stdoutTruncated
          ? `${stdout}\n\n…[truncated: output exceeded ${maxChars} characters]`
          : stdout
        resolve({ text, truncated: stdoutTruncated })
        return
      }
      if (exitCode === 3) {
        reject(
          new AnydocError(
            errorText || 'This document needs OCR before its text can be extracted.',
            'needsOcr'
          )
        )
        return
      }
      if (exitCode === 2) {
        reject(
          new AnydocError(
            errorText || 'The document converter rejected its invocation.',
            'usage'
          )
        )
        return
      }
      if (exitCode === 1) {
        reject(
          new AnydocError(errorText || 'The document could not be converted.', 'convert-failed')
        )
        return
      }
      reject(
        new AnydocError(
          errorText || `The document converter exited with code ${exitCode}.`,
          'failed'
        )
      )
    })
  })
}
