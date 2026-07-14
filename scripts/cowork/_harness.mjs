import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const coworkRoot = join(projectRoot, 'src', 'cowork')
export const cliRoot = join(projectRoot, 'packages', 'micromeet-cli')

export const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const readProject = (path) => readFileSync(join(projectRoot, path), 'utf8')
export const readCowork = (path) => readFileSync(join(coworkRoot, path), 'utf8')

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
  ['@cowork-main/', join(coworkRoot, 'main')],
  ['@cowork-shared/', join(coworkRoot, 'shared')],
  ['@cowork-renderer/', join(coworkRoot, 'renderer')],
  ['@cowork-preload/', join(coworkRoot, 'preload')]
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
  ['main/update/update.service.ts', new Set(['@main/updateHelper/update.service'])]
])

export const assertCoworkAliasBoundary = () => {
  const failures = []
  for (const path of walk(coworkRoot).filter((candidate) => sourceExtensions.has(extname(candidate)))) {
    const relative = path.slice(coworkRoot.length + 1)
    const source = readFileSync(path, 'utf8')
    const legacy = [...source.matchAll(/["'](@(?:main|shared|renderer|preload)\/[^"']+)["']/g)].map((match) => match[1])
    const allowed = hostAliasAllowlist.get(relative) || new Set()
    for (const specifier of legacy) {
      if (!allowed.has(specifier)) failures.push(`${relative}: forbidden host alias ${specifier}`)
    }
    for (const specifier of [...source.matchAll(/["'](@cowork-(?:main|shared|renderer|preload)\/[^"']+)["']/g)].map((match) => match[1])) {
      if (!resolveAliasImport(specifier)) failures.push(`${relative}: unresolved alias ${specifier}`)
    }
  }
  assert(failures.length === 0, `Cowork alias boundary failed:\n${failures.join('\n')}`)
}

export const assertNoStandaloneEntry = () => {
  assert(!existsSync(join(coworkRoot, 'main', 'app.main.ts')), 'embedded Cowork must not retain a standalone main entry')
}
