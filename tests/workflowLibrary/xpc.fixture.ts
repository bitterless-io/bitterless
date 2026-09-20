/**
 * Renderer XPC stand-in for the Workbench Workflows visual test.
 *
 * Serves what the LOCAL DIRECTORY scanner serves: a dynamic workflow's `meta`, read out of its script
 * without executing it. It used to serve a Kimchi `workflow.json` with a `graph{nodes,edges}` — that
 * manifest is gone, and with it the JSON tab and the node graph. A fixture still shaped like the old
 * manifest would keep the test green against a UI nobody ships.
 */
const root = '/Users/fixture/.bitterless/workflows'
const ENTRY = 'workflow.mjs'

const PHASES = [
  { title: 'Prepare', detail: 'read the input and normalize it' },
  { title: 'Count', detail: 'count the words' },
  { title: 'Summarize', detail: 'return one clear summary' }
]

const pack = (dir: string, name: string, description: string, error: string | null = null) => ({
  ref: `local:${dir}`, dir, path: `${root}/${dir}`, name, description,
  entry: ENTRY, entryPath: `${root}/${dir}/${ENTRY}`, bytes: 2026,
  modifiedAt: '2026-09-20T04:45:00.000Z',
  // The list carries phase TITLES only; the full phase objects arrive with the detail.
  phases: error ? [] : PHASES.map(phase => phase.title),
  error
})

const state = {
  root,
  scannedAt: '2026-09-20T04:45:00.000Z',
  dropped: 0,
  error: null,
  items: [
    pack('text-essentials', 'Text essentials', 'Prepare an input, count its words and return a clear summary. A small, deterministic workflow.'),
    pack('research-review', 'Research review', 'Compare evidence, explore alternatives and bring findings together.'),
    pack('release-checklist', 'Release checklist', 'A shared checklist for a deliberate release.'),
    { ...pack('broken-package', 'broken-package', '', `The workflow entry file ${ENTRY} is missing.`), entryPath: '' }
  ]
}

export const createXpcRendererEmitter = () => ({
  snapshot: async () => ({ ok: true, value: state }),
  detail: async ({ ref }: { ref: string }) => {
    const item = state.items.find(row => row.ref === ref)
    if (!item || item.error) return { ok: false, error: item?.error || 'Select a valid workflow.' }
    return { ok: true, value: { item, meta: { name: item.dir, description: item.description, phases: PHASES } } }
  },
  source: async () => ({ ok: true, value: { path: `${root}/text-essentials/${ENTRY}`, name: ENTRY, text: "export const meta = { name: 'text-essentials' }\n", bytes: 46, truncated: false } }),
  openRoot: async () => ({ ok: true, value: root }),
  reveal: async ({ ref }: { ref: string }) => ({ ok: true, value: `${root}/${ref.slice('local:'.length)}` }),
  importPackage: async () => ({ ok: true, value: null })
})
export const xpcRenderer = { subscribe: () => undefined }

Object.assign(window, {
  /** Swap the phase list a detail returns, for the "a long workflow still fits" check. */
  workflowVisualPhases(value: Array<{ title: string; detail?: string }>) { PHASES.length = 0; PHASES.push(...value) }
})
