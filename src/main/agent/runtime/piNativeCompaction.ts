import type { Extension, ExtensionContext, SessionBeforeCompactEvent } from '@earendil-works/pi-coding-agent'
import type { PiModule } from './piRuntimeProtocol'
import type { AgentRuntimeEvent } from './agentRuntime.types'
import { sanitizeRuntimeError } from './errorSanitizer'

export const PI_COMPACTION_SETTINGS = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } as const

export const DEFAULT_COMPACT_PROMPT = `Preserve unfinished, uncancelled user requests and commitments, including parallel work; later silence is not cancellation. Newer instructions replace only conflicting parts.

Distinguish verified results from attempts and plans; retain blockers, uncertainty, and the next concrete action. Keep exact references needed to resume.

Treat D1-D4 (time, workspace, active tab, open tabs) as message-time snapshots, not current state.

Keep still-relevant prior context, remove repetition, and never invent facts.`

export const resolveCompactPrompt = (value?: string, instructions?: string): string =>
  [value?.trim() || DEFAULT_COMPACT_PROMPT, instructions?.trim()].filter(Boolean).join('\n\n')

export interface PiCompactionState { error?: string; onEvent?: (event: AgentRuntimeEvent) => void }
type Compact = PiModule['compact']
const OWNER = 'host-native-compact-v1'

/** Pi 0.85.1 drops previousSummary for a prefix-only split. Remove after the native fix lands. */
export const preserveSplitTurnHistory = <T extends { summary: string }>(preparation: SessionBeforeCompactEvent['preparation'], result: T): T => {
  const separator = '\n\n---\n\n**Turn Context (split turn):**\n\n'
  const missingHistory = 'No prior history.' + separator
  if (preparation.isSplitTurn && preparation.turnPrefixMessages.length > 0 && preparation.messagesToSummarize.length === 0 && preparation.previousSummary != null && result.summary.startsWith(missingHistory)) {
    if (result.summary.startsWith(preparation.previousSummary + separator)) return result
    return { ...result, summary: preparation.previousSummary + result.summary.slice('No prior history.'.length) }
  }
  return result
}

/** Pi skips fromHook details; carry only our own previous native file lists forward. */
export const prepareHostCompaction = (event: SessionBeforeCompactEvent): SessionBeforeCompactEvent['preparation'] => {
  const preparation = event.preparation
  const fileOps = { read: new Set(preparation.fileOps.read), written: new Set(preparation.fileOps.written), edited: new Set(preparation.fileOps.edited) }
  const previous = [...event.branchEntries].reverse().find(entry => entry.type === 'compaction')
  if (previous?.type === 'compaction' && previous.fromHook) {
    const details = previous.details as { hostCompaction?: string; readFiles?: unknown; modifiedFiles?: unknown } | undefined
    if (details?.hostCompaction === OWNER) {
      if (Array.isArray(details.readFiles)) for (const file of details.readFiles) if (typeof file === 'string') fileOps.read.add(file)
      if (Array.isArray(details.modifiedFiles)) for (const file of details.modifiedFiles) if (typeof file === 'string') fileOps.edited.add(file)
    }
  }
  return { ...preparation, fileOps }
}

/** One host-owned extension; no filesystem extensions or alternative summary algorithm. */
export const createPiCompactionExtension = (pi: PiModule, options: {
  getPrompt?: () => string | undefined
  getStream: () => Parameters<Compact>[7]
  getRetry: () => Parameters<Compact>[9]
  state: PiCompactionState
}): Extension => {
  const handler = async (event: SessionBeforeCompactEvent, context: ExtensionContext) => {
    const focus = resolveCompactPrompt(options.getPrompt?.(), event.customInstructions)
    options.state.error = undefined
    let active = true
    let retry: { attempt: number; maxAttempts: number } | undefined
    const emit = (progress: AgentRuntimeEvent): void => { if (active && !event.signal.aborted) options.state.onEvent?.(progress) }
    const callbacks: Parameters<Compact>[10] = {
      onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
        retry = { attempt, maxAttempts }
        emit({ type: 'compaction_retry', attempt, maxAttempts, delayMs, error: sanitizeRuntimeError(errorMessage, 'provider') })
      },
      onRetryAttemptStart: () => { emit({ type: 'compaction_attempt', ...retry }) },
      onRetryFinished: () => { emit({ type: 'compaction_retry_finished' }); retry = undefined }
    }
    try {
      if (!context.model) throw new Error('No model selected for compaction.')
      const auth = await context.modelRegistry.getApiKeyAndHeaders(context.model)
      if (auth.ok === false) throw new Error(auth.error)
      const model = auth.baseUrl ? { ...context.model, baseUrl: auth.baseUrl } : context.model
      const headers = auth.headers ? Object.fromEntries(Object.entries(auth.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined
      const preparation = prepareHostCompaction(event)
      const nativeResult = await pi.compact(preparation, model, auth.apiKey, headers, focus,
        event.signal, context.thinkingLevel, options.getStream(), auth.env, options.getRetry(), callbacks)
      const result = preserveSplitTurnHistory(preparation, nativeResult)
      return { compaction: { ...result, details: { ...(result.details as Record<string, unknown>), hostCompaction: OWNER } } }
    } catch (error) {
      // ExtensionRunner swallows thrown hook errors and would run an unfocused fallback.
      // Cancel explicitly, preserving the actual error for the host's end event/manual reply.
      if (!event.signal.aborted) options.state.error = sanitizeRuntimeError(error instanceof Error ? error.message : String(error), 'provider')
      return { cancel: true }
    } finally { active = false }
  }
  const path = '<host:native-compaction>'
  return {
    path, resolvedPath: path, sourceInfo: { path, source: 'host', scope: 'temporary', origin: 'top-level' },
    handlers: new Map([['session_before_compact', [handler]]]) as Extension['handlers'], tools: new Map(),
    messageRenderers: new Map(), entryRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map()
  }
}
