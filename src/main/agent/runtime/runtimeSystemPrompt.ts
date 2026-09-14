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

/** Match pi's explicit cwd metadata for every provider; no resource discovery or persona fallback. */
export const resolveRuntimeSystemPrompt = (options: { systemPrompt: string; cwd?: string }): {
  hostText: string
  cwd: string
  finalSystemPrompt: string
} => {
  const hostText = requireSystemPrompt(options.systemPrompt)
  let input = options.cwd ?? process.cwd()
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
