import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Profile preference, independent of cloud state and changing package revisions. */
export class SkillState {
  private disabled = new Set<string>()
  private readonly file: string
  constructor(root: string) {
    this.file = join(root, 'skill-state.json')
    if (!existsSync(this.file)) return
    const value = JSON.parse(readFileSync(this.file, 'utf8'))
    if (value.version !== 1 || !Array.isArray(value.disabled) || value.disabled.some((key: unknown) => typeof key !== 'string')) throw new Error('Invalid skill-state.json; repair the local skill enablement settings')
    this.disabled = new Set(value.disabled)
  }
  enabled(reference: string): boolean { return !this.disabled.has(reference) }
  setEnabled(reference: string, enabled: boolean): void {
    const next = new Set(this.disabled)
    if (enabled) next.delete(reference); else next.add(reference)
    mkdirSync(dirname(this.file), { recursive: true })
    const stage = this.file + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(stage, JSON.stringify({ version: 1, disabled: [...next].sort() }), { flag: 'wx', mode: 0o600 })
      renameSync(stage, this.file)
      this.disabled = next
    } finally { rmSync(stage, { force: true }) }
  }
}
