import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

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
  // `agent/` was hoisted out of Maestro to `src/<process>/agent/` — agents are not
  // Maestro-specific. Callers still name it `main/agent/...`, so resolve it at the host
  // root rather than inserting the `maestro` segment.
  if (rest[0] === 'agent') return join(projectRoot, 'src', processName, ...rest)
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

/**
 * 逐文件放行 —— 这里每一条都是**真实的宿主耦合**,不是跨切面服务。列在这里是为了让它们
 * 可见、可数,而不是假装不存在;抽 SDK 时这些就是要逐条消解的债。
 * (i18n / 主题已改由 hostAliasPrefixAllowlist 覆盖,不再逐文件列。)
 */
const hostAliasAllowlist = new Map([
  ['main/security/sqliteKey.service.ts', new Set(['@main/security/safeStorage.runtime'])],
  ['main/update/update.service.ts', new Set(['@main/updateHelper/update.service'])],
  ['main/windows/window.helper.ts', new Set([
    '@main/windows/windowState.service',
    '@shared/window/window.types'
  ])],
  // 债:main 侧 Maestro 直接用宿主的出站 HTTP 分发器,而不是经由自己的端口。
  ['main/net/proxy.ts', new Set(['@main/networking/outboundHttpDispatcher.service'])],
  // 债:共享默认工作空间按 runtime profile id 分版本(与 userData 的版本隔离对齐,Preview 不能写进
  // Production 的文件),而这个 id 只有宿主的 runtime profile 知道。
  ['main/files/defaultWorkspace.ts', new Set(['@main/environment/runtimeProfile.runtime'])],
  // 债:localHome / workbench 直接用宿主的 home shell bridge(登录态与外壳通信)。
  ['renderer/localHome/src/localHomeAuth.store.ts', new Set([
    '@renderer/common/homeShellBridge.client',
    '@shared/home/homeShellBridge.contract'
  ])],
  ['renderer/workbench/src/views/WorkbenchAppsView.vue', new Set([
    '@renderer/common/homeShellBridge.client'
  ])]
])

// Not a per-file exception but a boundary that moved: the agent runtime now lives at
// `src/main/agent/`, outside Maestro, because agents are not Maestro-specific. Maestro code
// reaches it through the host alias by design, so listing each consumer would just be a
// second copy of the import graph.
const hostAliasPrefixAllowlist = [
  // 已抽出的 agent 树(Maestro 反向引用它是允许的)。
  '@main/agent/',
  // Main uses the same localized tab labels as the renderer for foreground snapshots.
  '@main/i18n/',
  // 宿主的 i18n 与主题是**跨切面服务**,Maestro 的 renderer 合法依赖它们。
  // 以前这是逐文件放行(4 条),而守卫自 2026 年某时起整套没执行过 ⇒ 漂移到 13 处没人发现。
  // 改成前缀:是规则就不会随文件增加而腐烂。
  '@renderer/common/i18n/',
  '@renderer/common/assets/style/',
  // timerHelper(`await timerHelper.delay(ms)`)是跨切面的公共工具，宿主与 Maestro 共用一份;
  // 挪进 src/shared/maestro/ 它就不是公共的了(docs/features/ui-act-wait-hover-jev.md #1)。
  '@shared/timerHelper/'
]

export const assertMaestroAliasBoundary = () => {
  const failures = []
  for (const [processName, root] of maestroRoots) {
    for (const path of walk(root).filter((candidate) => sourceExtensions.has(extname(candidate)))) {
      const relative = `${processName}/${path.slice(root.length + 1)}`
      const source = readFileSync(path, 'utf8')
      const legacy = [...source.matchAll(/["'](@(?:main|shared|renderer|preload)\/[^"']+)["']/g)].map((match) => match[1])
      const allowed = hostAliasAllowlist.get(relative) || new Set()
      for (const specifier of legacy) {
        if (allowed.has(specifier)) continue
        if (hostAliasPrefixAllowlist.some((prefix) => specifier.startsWith(prefix))) continue
        failures.push(`${relative}: forbidden host alias ${specifier}`)
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
