import { resolve } from 'node:path'

/** Bundle only Pi's skill APIs into Electron's CJS main, retaining the pinned SDK implementation. */
export const piSkillSdkPlugin = (projectRoot: string) => {
  const entry = '\0bitterless-pi-skill-sdk'
  const sdk = resolve(projectRoot, 'node_modules/@earendil-works/pi-coding-agent/dist')
  return {
    name: 'bitterless:pi-skill-sdk',
    enforce: 'pre' as const,
    resolveId(source: string) {
      // A bare package import is marked external by electron-vite before resolveId runs.
      // The explicit virtual ID keeps this narrow bridge bundled without changing the runtime SDK.
      if (source === 'virtual:bitterless-pi-skills') return entry
      return null
    },
    load(id: string) {
      if (id !== entry) return null
      return [
        `export { loadSkillsFromDir, formatSkillsForPrompt } from ${JSON.stringify(resolve(sdk, 'core/skills.js'))};`,
        `export { parseFrontmatter } from ${JSON.stringify(resolve(sdk, 'utils/frontmatter.js'))};`,
        `export { createSyntheticSourceInfo } from ${JSON.stringify(resolve(sdk, 'core/source-info.js'))};`
      ].join('\n')
    },
    transform(_code: string, id: string) {
      // loadSkillsFromDir/formatSkillsForPrompt do not use Pi's CLI configuration. Drop that
      // unused module (which assumes import.meta.url) when tree-shaking the narrow CJS bundle.
      if (id.startsWith(sdk + '/')) return { moduleSideEffects: false }
      return null
    }
  }
}
