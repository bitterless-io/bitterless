export const meta = {
  name: 'workflow-demo',
  description: 'Proves the local workflows folder end to end: this package is listed, its script is readable, and it runs without a model, a network or an account. It reads nothing and writes nothing — the only output is a short report about the text you give it.',
  whenToUse: 'Use when the owner wants to confirm the local workflows folder works end to end — that a package sitting in the workflows directory is listed, readable and actually runnable — or wants a plain word / line / character count of a short piece of text. The input is the text itself. Do NOT use it to read files, run commands, search, or answer questions about content: it reads nothing and only measures what it is handed.',
  phases: [{ title: 'Measure' }, { title: 'Report' }]
}

/**
 * The offline demo package.
 *
 * **It calls no agent on purpose.** Its job is to answer one question — "is the workflows folder
 * wired up?" — and it has to be able to answer it while signed out, offline, and with no model
 * configured. Adding an agent would make the smoke test depend on the very things it exists to rule
 * out. That makes it the exception, not the pattern: a real workflow orchestrates agents.
 *
 * Everything it varies on arrives in `args`. Edit this file directly to change it; the host re-reads
 * the folder on every save.
 */

const text = typeof args === 'string' ? args : (args && (args.text ?? args.input)) || ''
const trimmed = String(text).trim()

phase('Measure')
const words = trimmed ? trimmed.split(/\s+/u).length : 0
const lines = trimmed ? trimmed.split(/\r?\n/u).length : 0
log('measured ' + words + ' word(s) in ' + trimmed.length + ' character(s)')

phase('Report')
// Deterministic by construction: the same input gives the same report on every machine and every
// replay, which is what makes this usable as a smoke test rather than an illustration.
const message = 'Processed ' + words + ' words: ' + trimmed

return { words, lines, characters: trimmed.length, message }
