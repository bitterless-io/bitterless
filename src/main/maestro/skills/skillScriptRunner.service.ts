// Runner for a standard skill package's own helper script.
//
// Bitterless already staged `bun` (build/maestro-tools, `skillAuthoringRuntime().bunPath`) and
// already had `skill_creator` scaffold a `scripts/run.mjs`, but nothing could ever execute it —
// the file was dead weight on this side while micromeet-cowork ran the identical package. This is
// the paired half (Ral 2026-09-18:「参考 cowork 和 pi 的实现对齐」).
//
// Interpreter choice (Ral, same message:「run skill 不仅是 bun 也要有 bash 或是 pi 的方式兜底」):
//   .mjs/.js/.ts  → the BUNDLED bun. First, always, because it is the runtime we ship: a user with
//                   no developer environment still gets a working skill.
//   .sh/.bash     → Pi's own `getShellConfig()` (Git Bash on Windows, /bin/bash elsewhere)
//   .ps1          → Pi's `getPowerShellConfig()`
// Pi's config is reused for WHICH shell exists, not for its `args`: those are `-c`, for running a
// command STRING, and under `-c` the first operand becomes `$0`, so the script's own `$1` would
// silently come up empty. We run a FILE, so the file is the argument.
//
// Security posture mirrors micromeet-cowork's runner:
//  - confined: only a file inside the skill package runs, resolved through realpath so a symlink
//    under the package cannot smuggle an out-of-tree script past a string prefix check;
//  - clean env: the child never inherits this process's environment (secrets, proxy);
//  - timeout + hard kill of the whole process group, output size capped;
//  - JWT-shaped strings redacted before anything can reach the model.

import { existsSync, realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { getPowerShellConfig, getShellConfig } from './piSkillSdk'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const JWT_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g
export const SKILL_SCRIPT_EXTENSIONS = /\.(mjs|js|ts|sh|bash|ps1)$/

export interface RunSkillScriptOptions {
  scriptPath: string
  /** Package root; the script must live inside it. */
  packageRoot: string
  bunPath: string | null
  args?: string[]
  input?: Record<string, unknown>
  timeoutMs?: number
  signal?: AbortSignal
}
export interface SkillScriptResult { ok: boolean; stdout?: string; stderr?: string; exitCode?: number; error?: string }

const redact = (text: string): string => text.replace(JWT_RE, '[REDACTED_JWT]')
/** Minimal, secret-free environment. Never spread process.env — it carries the app's own secrets. */
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA']) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

export const runSkillScript = (opts: RunSkillScriptOptions): Promise<SkillScriptResult> =>
  new Promise((settle) => {
    if (opts.signal?.aborted) { settle({ ok: false, error: 'script cancelled' }); return }
    const raw = resolve(opts.scriptPath)
    if (!SKILL_SCRIPT_EXTENSIONS.test(raw)) { settle({ ok: false, error: 'script must be a .mjs, .js, .ts, .sh, .bash or .ps1 file' }); return }
    if (!existsSync(raw)) { settle({ ok: false, error: 'script not found' }); return }

    let scriptPath: string, packageRoot: string
    try { scriptPath = realpathSync(raw); packageRoot = realpathSync(resolve(opts.packageRoot)) }
    catch { settle({ ok: false, error: 'could not resolve script / package path' }); return }
    if (!scriptPath.startsWith(packageRoot + sep) || !SKILL_SCRIPT_EXTENSIONS.test(scriptPath)) {
      settle({ ok: false, error: 'script must be a supported file inside its skill package' })
      return
    }

    const shellScript = /\.(sh|bash)$/.test(scriptPath), powerShellScript = /\.ps1$/.test(scriptPath)
    let runtime: { cmd: string; args: string[] }
    if (shellScript || powerShellScript) {
      try {
        const config = powerShellScript ? getPowerShellConfig() : getShellConfig()
        runtime = { cmd: config.shell, args: powerShellScript ? ['-NoProfile', '-File', scriptPath] : [scriptPath] }
      } catch (error) {
        // On Windows without Git Bash this is the honest answer: name the missing interpreter
        // instead of handing a shell script to Bun, which would fail as an opaque syntax error.
        settle({ ok: false, error: redact(`no interpreter for this script: ${(error as Error).message}`) })
        return
      }
    } else {
      if (!opts.bunPath || !existsSync(opts.bunPath)) { settle({ ok: false, error: 'bundled Bun is unavailable; JavaScript skill scripts require it' }); return }
      runtime = { cmd: opts.bunPath, args: [scriptPath] }
    }

    const detached = process.platform !== 'win32'
    let stdout = '', stderr = '', bytes = 0, settled = false
    const child = spawn(runtime.cmd, [...runtime.args, ...(opts.args || [])], {
      cwd: packageRoot, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached
    })
    const stop = (): void => {
      try { if (detached && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL') }
      catch { /* already gone */ }
    }
    const finish = (result: SkillScriptResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      settle(result)
    }
    const onAbort = (): void => { stop(); finish({ ok: false, error: 'script cancelled' }) }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { stop(); finish({ ok: false, error: `script timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` }) }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    timer.unref?.()

    const collect = (chunk: Buffer, onto: 'out' | 'err'): void => {
      bytes += chunk.length
      if (bytes > MAX_OUTPUT_BYTES) { stop(); finish({ ok: false, error: 'script produced too much output' }); return }
      if (onto === 'out') stdout += chunk.toString(); else stderr += chunk.toString()
    }
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'out'))
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'err'))
    child.on('error', (error) => finish({ ok: false, error: redact(`could not start the script: ${error.message}`) }))
    child.on('close', (code) => finish({ ok: code === 0, exitCode: code ?? undefined, stdout: redact(stdout), stderr: redact(stderr).slice(0, 4000), ...(code === 0 ? {} : { error: `script exited with code ${code}` }) }))
    // Input arrives on stdin only — never argv or env, so it cannot leak through a process listing.
    try { child.stdin.end(JSON.stringify(opts.input ?? {})) } catch { /* the close handler reports it */ }
  })
