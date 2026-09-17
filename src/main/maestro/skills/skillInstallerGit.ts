import * as fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { SkillInstallError, type GitSourceFetcher } from './skillInstaller'

/** HTTPS-only Git transport. No git/ssh executable, shell, or lifecycle hooks. */
export function createGitSourceFetcher(options: {
  fetch?: typeof globalThis.fetch
  onAuth?: (url: string) => Promise<{ username: string; password?: string }>
} = {}): GitSourceFetcher {
  return async request => {
    const httpFetch = options.fetch || globalThis.fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.limits.timeoutMs)
    const abort = () => controller.abort()
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted) controller.abort()
    let transferred = 0
    const http = {
      async request(input: { url: string; method?: string; headers?: Record<string, string>; body?: AsyncIterable<Uint8Array> }) {
        const url = new URL(input.url)
        if (url.protocol !== 'https:' || url.username || url.password) throw new SkillInstallError('invalid-source', 'Git transport requires credential-free HTTPS URLs.')
        let body: Buffer | undefined
        if (input.body) { const pieces: Buffer[] = []; for await (const piece of input.body) pieces.push(Buffer.from(piece)); body = Buffer.concat(pieces) }
        const response = await httpFetch(input.url, { method: input.method || 'GET', headers: input.headers, body: body ? new Uint8Array(body).buffer : undefined, signal: controller.signal, redirect: 'error' })
        const stream = async function* () {
          const reader = response.body?.getReader(); if (!reader) return
          try {
            for (;;) {
              if (controller.signal.aborted) throw new SkillInstallError('cancelled', 'Git source download cancelled.')
              const next = await reader.read(); if (next.done) break
              transferred += next.value.length
              if (transferred > request.limits.downloadBytes) throw new SkillInstallError('limit', 'Git source exceeds the download limit.')
              yield next.value
            }
          } finally { await reader.cancel().catch(() => {}) }
        }
        return { url: response.url || input.url, statusCode: response.status, statusMessage: response.statusText, headers: Object.fromEntries(response.headers.entries()), body: stream() }
      }
    }
    try {
      await git.clone({ fs, http, dir: request.destination, url: request.url, ref: request.ref, singleBranch: true, depth: 1, noTags: true, onAuth: options.onAuth })
      if (controller.signal.aborted) throw new SkillInstallError(request.signal?.aborted ? 'cancelled' : 'timeout', 'Git source download was interrupted.')
      if (fs.existsSync(join(request.destination, '.gitmodules'))) throw new SkillInstallError('unsupported-resources', 'Git submodules require a source archive containing their resources.')
      const commit = await git.resolveRef({ fs, dir: request.destination, ref: 'HEAD' })
      await fsp.rm(join(request.destination, '.git'), { recursive: true, force: true })
      return { commit }
    } catch (error) {
      if (error instanceof SkillInstallError) throw error
      if (controller.signal.aborted) throw new SkillInstallError(request.signal?.aborted ? 'cancelled' : 'timeout', 'Git source download was interrupted.')
      throw new SkillInstallError('git-failed', 'The HTTPS Git source could not be fetched. Check its URL, ref, access, and supported protocol.')
    } finally { clearTimeout(timeout); request.signal?.removeEventListener('abort', abort) }
  }
}
