import { WORKFLOW_ENTRY_NAMES } from '../../../../shared/workflowPackage'
import type { DynamicWorkflowMeta } from '../../../../shared/workflowLibrary.type'

/**
 * Read a workflow package's `meta` — the single source of truth about it.
 *
 * **There is no `workflow.json` any more.** The Kimchi packaging kept a manifest beside the entry
 * and the two drifted constantly: the manifest's node graph was authored by hand, never executed,
 * and produced no runtime symptom when it disagreed with the code — the library just told a story
 * about a workflow that no longer existed. A dynamic workflow carries its own `meta`, so the
 * description, the phases and the routing hints are read from the same file that runs. The entire
 * class of manifest-vs-entry drift is gone, along with the check that used to guard it.
 *
 * `parseWorkflowScript` extracts the literal statically — it does not execute the script, so listing
 * a package still never runs it. Keys the engine does not know (`whenToUse`, `modelInvocation`)
 * survive the parse; they are ours, read here and nowhere else.
 */
export const DYNAMIC_ENGINE = 'pi-dynamic-workflows@3'

/**
 * The parser, loaded once — **not** a static import.
 *
 * `@quintinshaw/pi-dynamic-workflows` is ESM-only: its `exports` map offers `import` and no
 * `require`. The main process ships as a CJS bundle, and electron-vite externalizes dependencies, so
 * a static import here becomes `require("@quintinshaw/pi-dynamic-workflows")` in `app.main.js` and
 * the app dies at load with ERR_PACKAGE_PATH_NOT_EXPORTED — before any window opens. A dynamic
 * `import()` survives the CJS build verbatim, which is how this repo already reaches the Pi SDK
 * (`coworkLlm.service.ts`) and what `electron.vite.config.ts` means by "Pi is ESM-only … leaving the
 * full runtime dynamically imported".
 *
 * Loaded once at startup rather than per call so `parseDynamicWorkflow` stays SYNCHRONOUS: the
 * library scanner walks the directory synchronously, and making one parse async would turn scan,
 * detail and every caller above them async for a module load that happens once.
 */
type ParseWorkflowScript = (source: string) => { meta?: unknown } | null | undefined
let parseScript: ParseWorkflowScript | undefined

/** Call once before the first scan. Safe to call repeatedly; the module is cached. */
export const loadWorkflowParser = async (): Promise<void> => {
  if (parseScript) return
  const module = await import('@quintinshaw/pi-dynamic-workflows')
  parseScript = module.parseWorkflowScript as ParseWorkflowScript
}

export type { DynamicPhase, DynamicWorkflowMeta } from '../../../../shared/workflowLibrary.type'

const LIMITS = { name: 200, description: 8000, whenToUse: 4000, phaseTitle: 160, phaseDetail: 4000, phases: 50 } as const
const text = (value: unknown, field: string, max: number, required = true): string => {
  if (value === undefined || value === null) {
    if (required) throw new Error(`Workflow meta is missing ${field}.`)
    return ''
  }
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Invalid workflow ${field}.`)
  return value
}

/** Parse and validate a package's meta. Throws with a sentence the owner can act on. */
export const parseDynamicWorkflow = (source: string): DynamicWorkflowMeta => {
  if (typeof source !== 'string' || !source.trim()) throw new Error('The workflow script is empty.')
  let meta: Record<string, unknown>
  try {
    if (!parseScript) throw new Error('the workflow parser has not finished loading')
    const parsed = parseScript(source)
    meta = parsed?.meta as unknown as Record<string, unknown>
  } catch (error) {
    throw new Error(`This script has no usable \`export const meta\`: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('The workflow script must export a `meta` object.')
  const rawPhases = meta.phases === undefined ? [] : meta.phases
  if (!Array.isArray(rawPhases) || rawPhases.length > LIMITS.phases) throw new Error(`Workflow meta.phases must be an array of at most ${LIMITS.phases} entries.`)
  const phases = rawPhases.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each workflow phase must be an object with a title.')
    const phase = value as Record<string, unknown>
    return {
      title: text(phase.title, 'phase title', LIMITS.phaseTitle),
      ...(phase.detail === undefined ? {} : { detail: text(phase.detail, 'phase detail', LIMITS.phaseDetail, false) })
    }
  })
  // `modelInvocation` must be a real boolean: a string "false" is truthy, and silently treating it as
  // opted-in would put a package the author meant to withhold in front of the model on every turn.
  if (meta.modelInvocation !== undefined && typeof meta.modelInvocation !== 'boolean') throw new Error('Workflow meta.modelInvocation must be true or false.')
  return {
    name: text(meta.name, 'name', LIMITS.name),
    description: text(meta.description, 'description', LIMITS.description, false),
    whenToUse: text(meta.whenToUse, 'whenToUse', LIMITS.whenToUse, false),
    modelInvocation: meta.modelInvocation !== false,
    phases
  }
}

/** The entry file a package directory is expected to hold. */
export const DYNAMIC_ENTRY = WORKFLOW_ENTRY_NAMES[0]
/** Also accepted, so a package authored as `.js` is not rejected on an extension alone. */
export const DYNAMIC_ENTRY_ALTERNATIVES = WORKFLOW_ENTRY_NAMES.slice(1)
