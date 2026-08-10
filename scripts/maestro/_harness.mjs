import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const cliRoot = join(projectRoot, 'packages', 'micromeet-cli')

const maestroRoots = new Map([
  ['main', join(projectRoot, 'src', 'main', 'maestro')],
  ['preload', join(projectRoot, 'src', 'preload', 'maestro')],
  ['renderer', join(projectRoot, 'src', 'renderer', 'maestro')],
  ['shared', join(projectRoot, 'src', 'shared', 'maestro')]
])

export const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const readProject = (path) => readFileSync(join(projectRoot, path), 'utf8')
export const resolveMaestroPath = (relativePath) => {
  const [processName, ...rest] = relativePath.split('/')
  const root = maestroRoots.get(processName)
  assert(root, `unknown Maestro process boundary: ${processName}`)
  return join(root, ...rest)
}
export const readMaestro = (path) => readFileSync(resolveMaestroPath(path), 'utf8')

const walk = (directory) => {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}

const aliasRoots = new Map([
  ['@maestro-main/', maestroRoots.get('main')],
  ['@maestro-shared/', maestroRoots.get('shared')],
  ['@maestro-renderer/', maestroRoots.get('renderer')],
  ['@maestro-preload/', maestroRoots.get('preload')]
])

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue'])
const resolveAliasImport = (specifier) => {
  const entry = [...aliasRoots].find(([prefix]) => specifier.startsWith(prefix))
  if (!entry) return null
  const [prefix, root] = entry
  const base = join(root, specifier.slice(prefix.length))
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.json', '.png', '.svg', '.css', '.less'].map((suffix) => base + suffix),
    ...['index.ts', 'index.tsx', 'index.js', 'index.vue'].map((name) => join(base, name))
  ]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) || null
}

const hostAliasAllowlist = new Map([
  ['main/security/sqliteKey.service.ts', new Set(['@main/security/safeStorage.runtime'])],
  ['main/update/update.service.ts', new Set(['@main/updateHelper/update.service'])],
  ['main/windows/window.helper.ts', new Set([
    '@main/windows/windowState.service',
    '@shared/window/window.types'
  ])],
  ['renderer/control/src/control.ts', new Set([
    '@renderer/common/i18n/i18n.helper',
    '@renderer/common/i18n/rendererLanguage'
  ])],
  ['renderer/home/src/components/MenuBar/MenuBar.vue', new Set([
    '@renderer/common/i18n/i18n.helper'
  ])],
  ['renderer/home/src/main.ts', new Set([
    '@renderer/common/i18n/i18n.helper',
    '@renderer/common/i18n/rendererLanguage'
  ])],
  ['renderer/workbench/src/workbench.ts', new Set([
    '@renderer/common/i18n/i18n.helper',
    '@renderer/common/i18n/rendererLanguage'
  ])]
])

export const assertMaestroAliasBoundary = () => {
  const failures = []
  for (const [processName, root] of maestroRoots) {
    for (const path of walk(root).filter((candidate) => sourceExtensions.has(extname(candidate)))) {
      const relative = `${processName}/${path.slice(root.length + 1)}`
      const source = readFileSync(path, 'utf8')
      const legacy = [...source.matchAll(/["'](@(?:main|shared|renderer|preload)\/[^"']+)["']/g)].map((match) => match[1])
      const allowed = hostAliasAllowlist.get(relative) || new Set()
      for (const specifier of legacy) {
        if (!allowed.has(specifier)) failures.push(`${relative}: forbidden host alias ${specifier}`)
      }
      for (const specifier of [...source.matchAll(/["'](@maestro-(?:main|shared|renderer|preload)\/[^"']+)["']/g)].map((match) => match[1])) {
        if (!resolveAliasImport(specifier)) failures.push(`${relative}: unresolved alias ${specifier}`)
      }
    }
  }
  assert(failures.length === 0, `Maestro alias boundary failed:\n${failures.join('\n')}`)
}

export const assertNoStandaloneEntry = () => {
  assert(!existsSync(join(maestroRoots.get('main'), 'app.main.ts')), 'embedded Maestro must not retain a standalone main entry')
}
