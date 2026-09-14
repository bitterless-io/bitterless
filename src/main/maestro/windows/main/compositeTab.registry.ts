import type { MaestroCompositeTabSpec } from '@maestro-shared/compositeTab.api'

/**
 * The composite mini apps this Maestro build can host in a tab.
 *
 * Empty until a host registers something, which is the whole point: Maestro carries a native view
 * in a tab without knowing what is inside it, so nothing here imports a mini app and the alias
 * boundary stays intact.
 */
const specs = new Map<string, MaestroCompositeTabSpec>()

export const registerMaestroCompositeTab = (spec: MaestroCompositeTabSpec): void => {
  specs.set(spec.id, spec)
}

export const getMaestroCompositeTab = (id: string): MaestroCompositeTabSpec | null =>
  specs.get(id) ?? null

/**
 * Every registered composite mini app, in registration order.
 *
 * The new-tab menu is built from this rather than a hand-written list: "which mini apps can a tab
 * hold" is one fact, and a hand-written copy of it goes stale the first time a mini app is added.
 */
export const listMaestroCompositeTabs = (): MaestroCompositeTabSpec[] => [...specs.values()]

/**
 * 没设过主页时固有槽位装哪个 mini app —— 没有任何 spec 声明就返回 `null` = 内置本地 Home。
 *
 * 问 registry 而不是问一份默认设置,是为了让「默认值」跟着**这个构建注册了什么**走:maestro 这棵树
 * 不认识任何一个具体 mini app,宿主在注册处自己声明(`docs/features/onlypreview-default-homepage.md` #1)。
 * 声明了两个的话取先注册的那个 —— 语义上至多一个,由 `check-tab-alias.mjs` 在源码层钉住。
 */
export const defaultHomeMaestroCompositeTabId = (): string | null =>
  [...specs.values()].find((spec) => spec.defaultHome)?.id ?? null
