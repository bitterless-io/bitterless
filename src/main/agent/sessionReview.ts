import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import { sessionReviewReaderSource } from './sessionReviewReader'

export interface SessionReviewOptions {
  sessionId: string
  directory: string
  directories: string[]
}

const pending = new Map<string, Promise<void>>()

/** Build derived review files off the Electron main thread; never rewrite model I/O. */
export function prepareSessionReview(options: SessionReviewOptions): Promise<void> {
  const directory = resolve(options.directory)
  const existing = pending.get(directory)
  if (existing) return existing
  const operation = new Promise<void>((resolveReady, reject) => {
    const worker = new Worker(sessionReviewReaderSource, {
      eval: true,
      workerData: { options: { ...options, directory }, readerSource: sessionReviewReaderSource }
    })
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate().then(() => error ? reject(error) : resolveReady(), reject)
    }
    const timer = setTimeout(() => finish(new Error('Session review indexing timed out. Retry /copy_session_path.')), 30_000)
    worker.once('message', (message: { ok: boolean; error?: string }) => {
      finish(message.ok ? undefined : new Error(message.error || 'Unable to prepare session review files.'))
    })
    worker.once('error', finish)
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`Session review worker exited before completion (${code}).`))
    })
  })
  pending.set(directory, operation)
  void operation.finally(() => { if (pending.get(directory) === operation) pending.delete(directory) }).catch(() => undefined)
  return operation
}
