import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { screen, type BrowserWindow, type Display } from 'electron'

/**
 * Per-window geometry that survives restarts AND display changes.
 *
 * We persist the absolute bounds, the display the window was on (`displayId`), and
 * the window's offset within that display's work area (`relX`/`relY`). On restore:
 *  - the original display is still connected -> place at the same relative spot on it
 *    (so re-arranging monitors keeps the window where it visually "lived");
 *  - the original display is gone -> place at the SAME relative spot on the PRIMARY
 *    display, clamped to stay on-screen (the "monitor unplugged" fallback).
 *
 * Note (macOS): this tracks DISPLAYS, not Mission Control Spaces (虚拟桌面). Electron's
 * public API can neither read which Space a window is on nor move it to one, so a
 * window cannot be pinned back to a specific Space across restarts.
 */
export interface PersistedWindowState {
  x: number
  y: number
  width: number
  height: number
  maximized?: boolean
  fullScreen?: boolean
  displayId?: number
  relX?: number
  relY?: number
}

const MIN_W = 480
const MIN_H = 360
// A restored rect counts as on-screen if it overlaps some display's work area by at
// least this much — enough to grab the title bar and drag it back.
const MIN_VISIBLE = 80

/** BrowserWindow geometry overrides built from saved state, or null if unusable. */
export function computeRestoreBounds(
  saved: PersistedWindowState | null
): { x?: number; y?: number; width: number; height: number } | null {
  if (!saved || !isSaneSize(saved.width, saved.height)) return null
  const { width, height } = saved
  const displays = screen.getAllDisplays()

  // 1. Original display still connected -> same relative position on it.
  const original = saved.displayId != null ? displays.find((d) => d.id === saved.displayId) : undefined
  if (original) return { ...placeRelative(saved, original, width, height), width, height }

  // 2. Display id changed but the saved rect still lands on some connected display
  //    (e.g. an unrelated id reshuffle) -> keep the absolute position.
  if (isVisibleSomewhere({ x: saved.x, y: saved.y, width, height }, displays)) {
    return { x: saved.x, y: saved.y, width, height }
  }

  // 3. Original display gone -> same relative position on the primary display.
  return { ...placeRelative(saved, screen.getPrimaryDisplay(), width, height), width, height }
}

/** Snapshot a window's current geometry + which display it's on. */
export function captureWindowState(win: BrowserWindow): PersistedWindowState | null {
  if (win.isDestroyed()) return null
  // getNormalBounds() excludes the maximized/fullscreen frame so an un-maximize
  // later restores to a sensible size.
  const b = win.getNormalBounds()
  if (!isSaneSize(b.width, b.height)) return null
  const display = screen.getDisplayMatching(b)
  return {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
    displayId: display.id,
    relX: b.x - display.workArea.x,
    relY: b.y - display.workArea.y
  }
}

// Place the window at its saved offset within `display`'s work area, clamped so it
// stays visible (the saved offset may exceed a smaller fallback display).
function placeRelative(
  saved: PersistedWindowState,
  display: Display,
  width: number,
  height: number
): { x: number; y: number } {
  const wa = display.workArea
  const relX = saved.relX ?? saved.x - wa.x
  const relY = saved.relY ?? saved.y - wa.y
  return {
    x: clamp(wa.x + relX, wa.x, wa.x + Math.max(0, wa.width - width)),
    y: clamp(wa.y + relY, wa.y, wa.y + Math.max(0, wa.height - height))
  }
}

function isVisibleSomewhere(
  b: { x: number; y: number; width: number; height: number },
  displays: Display[]
): boolean {
  return displays.some((d) => {
    const wa = d.workArea
    const overlapX = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x)
    const overlapY = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y)
    return overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE
  })
}

function isSaneSize(width: unknown, height: unknown): width is number {
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= MIN_W &&
    height >= MIN_H
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Window geometry for every window, keyed by a stable per-window id, persisted as a
 * single `window-state.json` map under userData. One store instance is shared by all
 * windows so they never clobber each other's entries.
 */
export class WindowStateStore {
  private readonly file: string

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'window-state.json')
  }

  read(key: string): PersistedWindowState | null {
    return normalize(this.readAll()[key])
  }

  save(key: string, state: PersistedWindowState): void {
    const next = normalize(state)
    if (!next) return
    const all = this.readAll()
    all[key] = next
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(all, null, 2), 'utf8')
  }

  private readAll(): Record<string, PersistedWindowState> {
    if (!existsSync(this.file)) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
}

// Reject garbage/too-small geometry so a corrupt file can't open an unusable window.
function normalize(value: unknown): PersistedWindowState | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const width = toFiniteInt(v.width)
  const height = toFiniteInt(v.height)
  const x = toFiniteInt(v.x)
  const y = toFiniteInt(v.y)
  if (width === null || height === null || x === null || y === null) return null
  if (!isSaneSize(width, height)) return null
  return {
    x,
    y,
    width,
    height,
    ...(v.maximized === true ? { maximized: true } : {}),
    ...(v.fullScreen === true ? { fullScreen: true } : {}),
    ...(toFiniteInt(v.displayId) !== null ? { displayId: toFiniteInt(v.displayId)! } : {}),
    ...(toFiniteInt(v.relX) !== null ? { relX: toFiniteInt(v.relX)! } : {}),
    ...(toFiniteInt(v.relY) !== null ? { relY: toFiniteInt(v.relY)! } : {})
  }
}

function toFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value)
}

/**
 * Throttle with leading + trailing edges: run immediately, then at most once per
 * `ms`, and always once more after the final call so the last resize/move is saved.
 * Caps disk writes during a drag stream (which fires hundreds of events) while still
 * persisting the end state.
 */
export function throttle(fn: () => void, ms: number): () => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = (): void => {
    last = Date.now()
    timer = null
    fn()
  }
  return () => {
    const elapsed = Date.now() - last
    if (elapsed >= ms) {
      // leading edge / interval elapsed → fire now
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      run()
    } else if (!timer) {
      // trailing edge → fire once at the end of the current window
      timer = setTimeout(run, ms - elapsed)
    }
  }
}
