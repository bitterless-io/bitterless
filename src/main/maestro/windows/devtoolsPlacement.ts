/**
 * DevTools host 窗的落位 —— **纯几何**,不 import electron,所以 `node --test` 能直接跑它
 * (`tests/maestro/devtoolsPlacement.test.mjs`)。判据见
 * docs/features/maestro-devtools-follow-main-window.md #4。
 */

export interface DevToolsHostRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DevToolsPlacement {
  /** 主窗所在显示器的工作区(已排除菜单栏/Dock)。 */
  workArea: DevToolsHostRect
  /** 已经摆在那儿的 host 数量。它是**错开的槽位**,不是身份 —— 关掉一扇再开会复用腾出来的槽。 */
  index: number
}

/** 工作区边缘留白。 */
const MARGIN = 24
/** 每多一扇往左下错开的像素。 */
const STEP = 28
/** 错开这么多扇之后回到基准位。 */
const SLOTS = 6

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export const devToolsHostBounds = ({ workArea, index }: DevToolsPlacement): DevToolsHostRect => {
  // 先按比例取,再收进工作区 —— 小屏上 DevTools 不能比它要落进去的地方还大。
  const width = Math.min(
    clamp(Math.round(workArea.width * 0.45), 640, 1100),
    Math.max(workArea.width - MARGIN * 2, 1)
  )
  const height = Math.min(
    clamp(Math.round(workArea.height * 0.8), 480, 900),
    Math.max(workArea.height - MARGIN * 2, 1)
  )
  // 基准位是工作区右上角:主窗默认 1360 宽、偏左,右上角冲突最小。
  const slot = ((index % SLOTS) + SLOTS) % SLOTS
  const x = workArea.x + workArea.width - MARGIN - width - slot * STEP
  const y = workArea.y + MARGIN + slot * STEP
  return {
    x: Math.round(clamp(x, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(y, workArea.y, workArea.y + workArea.height - height)),
    width,
    height
  }
}
