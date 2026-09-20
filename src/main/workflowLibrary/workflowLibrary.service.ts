import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { DynamicWorkflowMeta, WorkflowLibraryDetail, WorkflowLibraryItem, WorkflowLibrarySnapshot, WorkflowSource } from '../../shared/workflowLibrary.type'
import { MAX_SOURCE_BYTES, MAX_WORKFLOW_PACKAGES } from '../../shared/workflowLibrary.type'
import { WORKFLOW_LIMITS } from '../../shared/workflowPackage'
import { DYNAMIC_ENTRY, DYNAMIC_ENTRY_ALTERNATIVES, parseDynamicWorkflow } from '../agent/workflowEngine/dynamic/dynamicLoader'

/**
 * The workflow library is a directory on this machine — no HTTP, no session, no institution
 * (docs/features/local-workflow-directory.md; scheme of record
 * `areas/agent-runtime/workflow/workflow.html` #1).
 *
 * One package = one directory holding `workflow.json` plus the entry it names. Identity is the
 * directory name, because that is the only thing the owner can see, rename and recognise in Finder;
 * inventing a UUID would leave the list and the folder with no way to be matched up.
 *
 * **A broken package is listed with its reason, never skipped.** Putting a folder in the directory
 * and not finding it in the list leaves the owner with nothing to do but restart, reinstall and
 * doubt the feature — a more expensive path than any error message.
 */
const PACKAGE_DIR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const WATCH_DEBOUNCE_MS = 300
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
export const workflowRefOf = (dir: string): string => `local:${dir}`

interface LibraryOptions {
  root: () => string
  changed?: (snapshot: WorkflowLibrarySnapshot) => void
}
interface Scanned { item: WorkflowLibraryItem; meta: DynamicWorkflowMeta | null }

export class WorkflowLibraryService {
  private scanned: Scanned[] = []
  private state: WorkflowLibrarySnapshot = { root: '', scannedAt: '', items: [], dropped: 0, error: null }
  private watcher: FSWatcher | null = null
  private watchedRoot = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(private readonly options: LibraryOptions) {}

  /** Rescan and publish. Cheap enough to be the answer to every "did something change?" question. */
  snapshot(): WorkflowLibrarySnapshot {
    if (this.disposed) return this.state
    const root = this.options.root()
    let entries: string[] = []
    let error: string | null = null
    try {
      mkdirSync(root, { recursive: true })
      entries = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => a.localeCompare(b))
    } catch (failure) { error = message(failure) }
    const dropped = Math.max(0, entries.length - MAX_WORKFLOW_PACKAGES)
    this.scanned = entries.slice(0, MAX_WORKFLOW_PACKAGES).map(dir => this.read(root, dir))
    this.state = { root, scannedAt: new Date().toISOString(), items: this.scanned.map(row => row.item), dropped, error }
    this.watch(root)
    this.options.changed?.(this.state)
    return this.state
  }

  /** The manifest of one package, re-read from disk: the snapshot may predate the owner's last save. */
  detail(ref: string): WorkflowLibraryDetail {
    const row = this.read(this.options.root(), this.dirOf(ref))
    if (!row.meta) throw new Error(row.item.error || 'This workflow package could not be read.')
    return { item: row.item, meta: row.meta }
  }

  /** Read the entry file as text. An empty read is an error: a blank pane and a real empty file look identical. */
  source(ref: string): WorkflowSource {
    const { item } = this.detail(ref)
    return this.readText(item.entryPath, item.entry)
  }

  private readText(path: string, name: string): WorkflowSource {
    const stats = statSync(path, { throwIfNoEntry: false })
    if (!stats?.isFile()) throw new Error(`The workflow script ${name} is missing.`)
    if (!stats.size) throw new Error(`The workflow script ${name} is empty.`)
    const bytes = readFileSync(path).subarray(0, MAX_SOURCE_BYTES)
    if (bytes.includes(0)) throw new Error(`The workflow script ${name} is not UTF-8 text.`)
    return { path, name, text: bytes.toString('utf8'), bytes: stats.size, truncated: stats.size > MAX_SOURCE_BYTES }
  }

  /** Absolute package directory for a ref, for "reveal in Finder". */
  directory(ref: string): string {
    const path = join(this.options.root(), this.dirOf(ref))
    if (!existsSync(path)) throw new Error('This workflow package is no longer in the workflows folder.')
    return path
  }

  /**
   * The run gate. Replaces the institution authorization that guarded the managed library: a path
   * inside the workflows root may only run when it is the **entry a manifest declares**. A script
   * someone dropped in a package's `reference/` does not become executable by sitting in the root.
   */
  assertPath(path: string): void {
    const rootPath = this.options.root()
    const root = existsSync(rootPath) ? realpathSync(rootPath) : resolve(rootPath)
    const actual = existsSync(path) ? realpathSync(path) : resolve(path)
    // Outside the root: an explicit owner-supplied path, governed by the caller's own rules.
    if (actual !== root && !actual.startsWith(root + sep)) return
    const entries = this.snapshot().items.filter(item => item.entryPath).map(item => existsSync(item.entryPath) ? realpathSync(item.entryPath) : resolve(item.entryPath))
    if (!entries.includes(actual)) throw new Error('Only the entry file a workflow package declares can be run from the workflows folder.')
  }

  items(): WorkflowLibraryItem[] { return this.state.items }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.watcher?.close()
    this.watcher = null
    this.watchedRoot = ''
  }

  private dirOf(ref: string): string {
    const dir = typeof ref === 'string' && ref.startsWith('local:') ? ref.slice('local:'.length) : ''
    if (!PACKAGE_DIR.test(dir)) throw new Error('Select a valid workflow.')
    return dir
  }

  private read(root: string, dir: string): Scanned {
    const path = join(root, dir)
    const base: WorkflowLibraryItem = {
      ref: workflowRefOf(dir), dir, path, name: dir, description: '', entry: '', entryPath: '',
      bytes: 0, modifiedAt: '', phases: [], whenToUse: '', modelInvocation: true, error: null
    }
    try { base.modifiedAt = statSync(path).mtime.toISOString() } catch { /* reported by the checks below */ }
    if (!PACKAGE_DIR.test(dir)) return { item: { ...base, error: 'Rename this folder to letters, digits, dot, dash or underscore (max 64).' }, meta: null }
    // The script IS the package: its `meta` is read from the same file that runs, so there is no
    // second document to drift from it (dynamicLoader.ts). Parsing is static — listing never executes.
    const candidates = [DYNAMIC_ENTRY, ...DYNAMIC_ENTRY_ALTERNATIVES]
    const found = candidates.map(name => ({ name, path: join(path, name) })).find(candidate => statSync(candidate.path, { throwIfNoEntry: false })?.isFile())
    if (!found) return { item: { ...base, error: `No workflow script here. Add ${DYNAMIC_ENTRY} exporting \`const meta\`.` }, meta: null }
    const stats = statSync(found.path, { throwIfNoEntry: false })
    if (!stats?.size) return { item: { ...base, entry: found.name, entryPath: found.path, error: `${found.name} is empty.` }, meta: null }
    if (stats.size > WORKFLOW_LIMITS.script) return { item: { ...base, entry: found.name, entryPath: found.path, error: `${found.name} is larger than ${WORKFLOW_LIMITS.script / 1024} KiB.` }, meta: null }
    const withEntry: WorkflowLibraryItem = { ...base, entry: found.name, entryPath: found.path, bytes: stats.size }
    try {
      const meta = parseDynamicWorkflow(readFileSync(found.path, 'utf8'))
      return {
        item: {
          ...withEntry,
          name: meta.name || dir,
          description: meta.description,
          phases: meta.phases.map(phase => phase.title),
          whenToUse: meta.whenToUse,
          modelInvocation: meta.modelInvocation
        },
        meta
      }
    } catch (error) { return { item: { ...withEntry, error: message(error) }, meta: null } }
  }

  /**
   * Recursive watch, debounced. This is what makes "the folder is the truth" true: the owner adds a
   * package in Finder and the list follows. `recursive` is supported on macOS and Windows — which is
   * every platform this app supports — and a failure to watch degrades to the refresh button rather
   * than to a broken view.
   */
  private watch(root: string): void {
    if (this.disposed || this.watchedRoot === root) return
    this.watcher?.close()
    this.watchedRoot = root
    try {
      this.watcher = watch(root, { recursive: true }, () => {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => { this.timer = null; if (!this.disposed) this.snapshot() }, WATCH_DEBOUNCE_MS)
      })
      this.watcher.unref?.()
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null; this.watchedRoot = '' })
    } catch { this.watcher = null; this.watchedRoot = '' }
  }
}
