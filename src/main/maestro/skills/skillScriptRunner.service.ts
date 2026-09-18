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

/** How many in-flight output lines reach the activity strip — enough to show it is moving, not a flood. */
const MAX_STREAMED_LINES = 200

export interface RunSkillScriptOptions {
  scriptPath: string
  /** Package root; the script must live inside it. */
  packageRoot: string
  bunPath: string | null
  args?: string[]
  input?: Record<string, unknown>
  timeoutMs?: number
  signal?: AbortSignal
  /**
   * Every line the script prints WHILE it runs.
   *
   * Ral 2026-09-18:「技能脚本执行过程中，要能依据打印，给用户持续的反馈，而不是脚本执行完了
   * 一次性给反馈」. A script that syncs dozens of submodules prints progress for minutes; buffering
   * all of it until exit shows the person a silent wait that is indistinguishable from a hang.
   *
   * Called per COMPLETE line, not per chunk — a chunk boundary is not a line boundary, so forwarding
   * chunks would split one line across two callbacks or glue ten lines into one. Paired with
   * micromeet-cowork's skillMjsRunner.
   */
  onOutput?: (line: string, stream: 'stdout' | 'stderr') => void
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

    // Live progress (see RunSkillScriptOptions.onOutput). Line-buffered and capped: a chatty script
    // must not flood the activity strip, so only the first MAX_STREAMED_LINES are forwarded and each
    // is truncated. The buffered stdout/stderr returned to the caller is unchanged.
    let streamedLines = 0
    const emitLine = (line: string, stream: 'stdout' | 'stderr'): void => {
      const text = line.trim()
      if (!text || !opts.onOutput || streamedLines >= MAX_STREAMED_LINES) return
      streamedLines++
      opts.onOutput(text.length > 300 ? `${text.slice(0, 300)}…` : text, stream)
    }
    const lineFeeder = (stream: 'stdout' | 'stderr') => {
      let carry = ''
      return (chunk: string, flush = false): void => {
        if (!opts.onOutput) return
        carry += chunk
        const parts = carry.split(/\r?\n/)
        carry = flush ? '' : parts.pop() ?? ''
        for (const line of parts) emitLine(line, stream)
        if (flush && carry) emitLine(carry, stream)
      }
    }
    const feedOut = lineFeeder('stdout'), feedErr = lineFeeder('stderr')

    const collect = (chunk: Buffer, onto: 'out' | 'err'): void => {
      bytes += chunk.length
      if (bytes > MAX_OUTPUT_BYTES) { stop(); finish({ ok: false, error: 'script produced too much output' }); return }
      const text = chunk.toString()
      if (onto === 'out') { stdout += text; feedOut(text) } else { stderr += text; feedErr(text) }
    }
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'out'))
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'err'))
    child.on('error', (error) => finish({ ok: false, error: redact(`could not start the script: ${error.message}`) }))
    // Flush a trailing line with no newline — a script's last line is often its conclusion.
    child.on('close', (code) => { feedOut('', true); feedErr('', true); return finish({ ok: code === 0, exitCode: code ?? undefined, stdout: redact(stdout), stderr: redact(stderr).slice(0, 4000), ...(code === 0 ? {} : { error: `script exited with code ${code}` }) }) })
    // Input arrives on stdin only — never argv or env, so it cannot leak through a process listing.
    try { child.stdin.end(JSON.stringify(opts.input ?? {})) } catch { /* the close handler reports it */ }
  })
