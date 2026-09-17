import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'
import { resolveConfig } from 'electron-vite'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const app = resolve(import.meta.dirname, '../..')
const sdkPackage = '@earendil-works/pi-coding-agent'

for (const command of ['serve', 'build']) test(`real electron-vite ${command} configuration loads native Pi skills in CJS`, async t => {
  const previousCwd = process.cwd()
  process.chdir(app)
  t.after(() => process.chdir(previousCwd))
  const root = mkdtempSync(join(tmpdir(), 'bl-pi-cjs-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'fixture')); writeFileSync(join(root, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: Native bundled fixture\n---\nBody')
  const entry = join(root, 'entry.ts')
  writeFileSync(entry, `export * from ${JSON.stringify(join(app, 'src/main/maestro/skills/piSkillSdk.ts'))};\nexport const loadRuntime = () => import('${sdkPackage}');\n`)
  // Use the actual Electron presets/externalization for both dev and packaged builds. Calling
  // Vite build on the resolved dev main config is also how electron-vite dev compiles main.
  // Only unrelated output-writing hooks and the app entry are replaced; no Electron is launched.
  const { config } = await resolveConfig({ root: app, configFile: join(app, 'electron.vite.config.ts'), logLevel: 'silent' }, command, command === 'serve' ? 'development' : 'production')
  const main = config.main
  main.plugins = main.plugins.filter(plugin => !['bitterless:runtime-profile-build-marker', 'workflow:utility-workers'].includes(plugin?.name))
  let externalizationChecked = false
  main.plugins.push({ name: 'test:retain-real-externalization', configResolved(config) {
    assert.ok(config.plugins.some(plugin => plugin.name === 'vite:externalize-deps'))
    assert.ok(config.build.rollupOptions.external.includes(sdkPackage), 'the full ESM SDK must stay external')
    externalizationChecked = true
  } })
  main.build = { ...main.build, write: false, watch: null, rollupOptions: {
    ...main.build.rollupOptions, input: entry, preserveEntrySignatures: 'strict'
  } }
  const result = await build(main)
  assert.ok(externalizationChecked)
  const chunks = result.output.filter(chunk => chunk.type === 'chunk')
  assert.equal(chunks.length, 1)
  const code = chunks[0].code
  assert.doesNotMatch(code, /require\s*\(["']@earendil-works\/pi-coding-agent(?:\/[^"']*)?["']\)/)
  assert.match(code, /import\(["']@earendil-works\/pi-coding-agent["']\)/)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(createRequire(join(app, 'package.json')), module, module.exports, join(app, 'out/main/app.main.js'), join(app, 'out/main'))
  const loaded = module.exports.loadSkillsFromDir({ dir: root, source: 'global' })
  assert.equal(loaded.skills.length, 1)
  assert.equal(loaded.skills[0].name, 'fixture')
  assert.ok(module.exports.formatSkillsForPrompt(loaded.skills).includes('<available_skills>'))
  assert.equal(module.exports.parseFrontmatter('---\nname: fixture\n---\nBody').frontmatter.name, 'fixture')
  assert.equal(module.exports.createSyntheticSourceInfo(root, { source: 'global', scope: 'user' }).scope, 'user')
})
