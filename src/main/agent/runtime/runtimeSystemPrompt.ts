import { homedir } from 'os'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

/** The host owns system instructions. Validation must never rewrite their text. */
export const requireSystemPrompt = (text: string): string => {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('systemPrompt is required and must not be blank — runtime defaults are not allowed')
  }
  return text
}

/**
 * Match pi's explicit cwd metadata for every provider; no resource discovery or persona fallback.
 *
 * `cwd` is REQUIRED. It used to fall back to `process.cwd()`, which made the value depend on how the
 * app was launched — `/` for a Finder-launched `.app`, the project directory for a terminal
 * `yarn dev` — so the shipped prompt ended with `Current working directory: /` while the same turn's
 * D2 line named the real workspace. cwd is the relative-path base for all seven pi builtins and the
 * literal `spawn` cwd for bash, so a silent default is a silent behaviour change.
 * See docs/features/agent-cwd-follows-workspace.md.
 *
 * Note this does NOT send the trailing line to pi: pi appends `Current working directory:` itself
 * from its own `AgentSession._cwd` (core/system-prompt.js). `finalSystemPrompt` is the host's MIRROR
 * of what pi will produce, asserted in PiRuntimeSession.setSystemPrompt.
 */
export const resolveRuntimeSystemPrompt = (options: { systemPrompt: string; cwd: string }): {
  hostText: string
  cwd: string
  finalSystemPrompt: string
} => {
  const hostText = requireSystemPrompt(options.systemPrompt)
  if (typeof options.cwd !== 'string' || !options.cwd.trim()) {
    throw new Error('cwd is required — the runtime must never fall back to the process working directory')
  }
  let input = options.cwd
  if (process.platform === 'win32' && !input.includes('\\')) {
    const drive = input.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i)
    if (drive) input = `${drive[1].toUpperCase()}:\\${drive[2]?.replaceAll('/', '\\') ?? ''}`
  }
  if (input === '~') input = homedir()
  else if (input.startsWith('~/') || (process.platform === 'win32' && input.startsWith('~\\'))) input = join(homedir(), input.slice(2))
  else if (input.startsWith('file://')) input = fileURLToPath(input)
  const cwd = resolve(input)
  return { hostText, cwd, finalSystemPrompt: hostText + '\nCurrent working directory: ' + cwd.replace(/\\/g, '/') + '\n' }
}
