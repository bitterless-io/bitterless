/**
 * Limits every workflow package is held to, and the archive path guard.
 *
 * The Kimchi manifest parser that used to live here is gone with `workflow.json`: a package is now a
 * script whose own `export const meta` is the single source, validated by
 * `main/agent/workflowEngine/dynamic/dynamicLoader.ts`. What survives is what is still true of any
 * package — its size bounds, and the fact that a ZIP someone sends you is untrusted input.
 */
export const WORKFLOW_LIMITS = { compressed: 20 * 1024 * 1024, expanded: 100 * 1024 * 1024, files: 500, script: 256 * 1024 } as const

/**
 * Reject an archive entry name that would escape its package, collide with a device name, or rely on
 * a separator the extractor and the checker read differently. Applied to every entry of an imported
 * ZIP before anything is written.
 */
export const safePackagePath = (value: string): string => {
  if (!value || value.length > 240 || /[\\\x00-\x1f:<>"|?*]/.test(value) || value.startsWith('/') || value.endsWith('/')) throw new Error('Unsafe workflow archive path.')
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe workflow archive path.')
  return value
}

/**
 * The entry file names a workflow package may use, and the one predicate that decides whether a path
 * is runnable.
 *
 * **Why this lives in `shared/`:** the scanner, the run gate in `hostIntegration`, and the renderer's
 * `/workflow <path>` command each have to agree on it, and they sit in three different bundles. When
 * they did not agree the failure was silent and total — the engine moved to `workflow.mjs`, the
 * scanner followed, and the run gate kept demanding `.ts`. Every local package therefore LISTED
 * correctly, showed its phases and its source, and then refused to start with "Workflow file must be
 * an absolute .ts or .mts path." Nothing reported a mismatch, because from each side's own point of
 * view it was behaving correctly.
 *
 * `workflow.mjs` first: it is what a package should ship. The rest are accepted because the engine
 * runs plain JS and a package authored before the change should not stop working.
 */
export const WORKFLOW_ENTRY_NAMES = ['workflow.mjs', 'workflow.js', 'workflow.mts', 'workflow.ts'] as const

/** Extensions derived from the names above, so the two can never disagree. */
export const WORKFLOW_ENTRY_EXTENSIONS: readonly string[] = [...new Set(WORKFLOW_ENTRY_NAMES.map(name => name.slice(name.lastIndexOf('.'))))]

/** True when this path names a file the engine can run. Case-insensitive; macOS and Windows are. */
export const isWorkflowEntryPath = (value: string): boolean =>
  WORKFLOW_ENTRY_EXTENSIONS.some(extension => value.toLowerCase().endsWith(extension))
