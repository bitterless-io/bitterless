import type { WorkflowLibraryItem } from '../../shared/workflowLibrary.type'

/**
 * The workflow catalog as it appears in the system prompt
 * (docs/features/workflow-catalog-in-prompt.md ①).
 *
 * **Why resident rather than behind `workflow_list`.** A workflow can only be started from natural
 * language if the model knows one exists. Behind a tool call it learns that only if it guesses to
 * look — so asked to do something a package handles, it does the work itself, with no signal that a
 * better route existed. Skills in this same prompt are already resident (`formatSkillsForPrompt`);
 * this closes the gap between the two.
 *
 * XML for the same reason skills use it: the fence is what lets the model tell a catalog apart from
 * an instruction inside 70k characters of reference material.
 */
const BUDGET_BYTES = 8 * 1024
const bytes = (value: string): number => Buffer.byteLength(value, 'utf8')
const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim()

/** One row. `when_to_use` is omitted rather than emitted empty — an empty tag reads as "never". */
const row = (item: WorkflowLibraryItem, reference: string): string => [
  '  <workflow>',
  `    <reference>${escape(reference)}</reference>`,
  `    <name>${escape(item.name)}</name>`,
  `    <description>${escape(item.description)}</description>`,
  ...(item.whenToUse.trim() ? [`    <when_to_use>${escape(item.whenToUse)}</when_to_use>`] : []),
  '  </workflow>'
].join('\n')

/**
 * Render the catalog from an already-published snapshot.
 *
 * `items` is the last scan, never a fresh one: this is rebuilt on every turn and every steer, and
 * re-parsing 200 manifests there would put a directory scan on the latency path of typing. The
 * `fs.watch` in `WorkflowLibraryService` is what keeps the snapshot equal to the folder — which is
 * also why the first scan has to happen at boot, not on first use.
 */
export const renderWorkflowCatalog = (items: WorkflowLibraryItem[], referenceOf: (item: WorkflowLibraryItem) => string): string => {
  // Broken packages are the Workbench's business, not the model's: the owner has to see them, and
  // the model must not be handed something it cannot run.
  const broken = items.filter(item => item.error).length
  const withheld = items.filter(item => !item.error && !item.modelInvocation).length
  const usable = items.filter(item => !item.error && item.modelInvocation)

  const rows: string[] = []
  let used = 0
  let dropped = 0
  for (const item of usable) {
    const rendered = row(item, referenceOf(item))
    // A silently truncated catalog reads as "these are all of them", which is the one thing it must
    // never read as — so the budget stops adding rows and the count is stated below.
    if (used + bytes(rendered) > BUDGET_BYTES) { dropped += 1; continue }
    used += bytes(rendered)
    rows.push(rendered)
  }

  const notes = [
    rows.length
      ? 'Start one with workflow_run, passing its <reference> as `name` and the task, target and success criteria as `input`. It runs in the background and reports back into this chat.'
      : 'No workflow package is installed. Do not invent a reference; the owner adds packages to the workflows folder.',
    dropped ? `${dropped} further workflow(s) are installed but omitted here for length — call workflow_list to see them.` : '',
    withheld ? `${withheld} installed workflow(s) declare modelInvocation:false and are deliberately absent; run one only if the owner names it.` : '',
    broken ? `${broken} installed package(s) cannot be read and are excluded; the owner sees the reason in the Workbench.` : '',
    'This list was captured when this message was built. Call workflow_list if the owner says they just added or changed one.'
  ].filter(Boolean)

  return ['<available_workflows>', ...rows, '</available_workflows>', ...notes].join('\n')
}
