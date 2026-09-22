import { is } from '@electron-toolkit/utils'

/**
 * **谁的 DevTools 开不开,只有这一个判据。**
 *
 * 2026-09-22 之前是五份各写各的(`window.helper` 的 `shouldOpenDevTools`、control、workbench、
 * operation、pinned home 各一份),互不相认:关闭开关只有前两份认,其余只看 `=== '1'`,而 `is.dev`
 * 又排在最前面短路掉 —— **任何 `=0` 在 dev 下都是空操作**
 * (`docs/issues/control-devtools-do-not-open-in-dev.md`)。
 *
 * 形状是**先否后可**:关闭开关对每个表面一视同仁、排在最前,per-surface 的 `=1` 只能在默认关的
 * 时候把某一个单独打开,**不能**反过来绕开关闭开关。
 *
 * BL 比 cowork 多两道自己的闸,保留:`VITE_MODE !== 'debug'`(非 debug 构建一律不开)与
 * `BITTERLESS_E2E`。
 */
export type DevToolsSurface = 'window' | 'control' | 'workbench' | 'operation' | 'home'

/** 每个表面自己的强制开关(`=1` 开)。 */
const SURFACE_ENV: Partial<Record<DevToolsSurface, string>> = {
  workbench: 'COACH_WORKBENCH_DEVTOOLS'
}

/**
 * 默认档:dev 下开。
 *
 * `operation` 是例外 —— 默认**关**,只能显式打开:那是一个被 `debugger.attach()` 接管的页面,
 * DevTools 一挂就跟 capture 抢 debugger,SPA 重渲染还会在它上面闪。
 */
const OPT_IN_ONLY: ReadonlySet<DevToolsSurface> = new Set<DevToolsSurface>(['operation'])

/**
 * 反过来的一档:**debug 构建里一律开**,不看 `is.dev`。
 *
 * `home` 是固定的本地首页,打包的 debug 版里也要能查 —— 它原来的判据就是
 * 「VITE_MODE 是 debug 且不在 E2E」,没有 `is.dev` 这一项。统一闸不能把这条差异抹掉:
 * 抹掉之后 debug 包里的 Home 就再也开不出 DevTools 了。
 */
const ALWAYS_ON_IN_DEBUG: ReadonlySet<DevToolsSurface> = new Set<DevToolsSurface>(['home'])

export const shouldOpenDevTools = (surface: DevToolsSurface): boolean => {
  // ── 关闭开关:一视同仁,排在最前,谁也绕不过去 ──
  if (import.meta.env.VITE_MODE !== 'debug') return false
  if (process.env.BITTERLESS_E2E === '1') return false
  if (process.env.COACH_DEMO_SMOKE_OUT) return false
  if (process.env.COACH_OPEN_DEVTOOLS === '0') return false
  if (process.env.COACH_DEVTOOLS === '0') return false

  // ── 强制打开:per-surface 优先于全局 ──
  const surfaceEnv = SURFACE_ENV[surface]
  if (surfaceEnv && process.env[surfaceEnv] === '1') return true
  if (process.env.COACH_DEVTOOLS === '1') return true
  if (process.env.COACH_OPEN_DEVTOOLS === '1') return true

  // ── 默认档 ──
  if (OPT_IN_ONLY.has(surface)) return false
  if (ALWAYS_ON_IN_DEBUG.has(surface)) return true
  return is.dev
}
