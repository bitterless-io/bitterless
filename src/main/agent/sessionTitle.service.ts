import type { SessionTitleRequest, SessionTitleResult } from '@maestro-shared/coach.api';
import { maestroAgentDir, maestroAuthPath, maestroModelsPath } from '@maestro-main/llm/llmPaths';
import type { AgentRuntimeAdapter, AgentRuntimeSession } from './runtime/agentRuntime.types';
import { PiRuntimeAdapter } from './runtime/piRuntimeAdapter';
import { excerptSessionTitleInput, SESSION_TITLE_SKILL, validateSessionTitle } from './sessionTitle.skill';

const TITLE_DEADLINE_MS = 20_000;
const CLEANUP_WAIT_MS = 250;
const OUTPUT_LIMIT = 2000;

const abortTitleSession = async (session: AgentRuntimeSession): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => session.abort()).catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, CLEANUP_WAIT_MS); })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** One transient worker, independent of main-chat turns, events, history and I/O logging. */
export class SessionTitleService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly runtime: Pick<AgentRuntimeAdapter, 'createSession'> = new PiRuntimeAdapter()) {}

  generate(request: SessionTitleRequest): Promise<SessionTitleResult> {
    if (!request || ![request.requestId, request.sessionId, request.firstMessageId].every(
      value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256
    ) || typeof request.text !== 'string') return Promise.resolve({ ok: false });
    const text = excerptSessionTitleInput(request.text);
    if (!text) return Promise.resolve({ ok: false });
    const result = this.queue.then(() => this.run(text));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async run(text: string): Promise<SessionTitleResult> {
    let ended = false;
    let session: AgentRuntimeSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The deadline starts when this queued job starts, before auth/model/session initialization.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('title-deadline')), TITLE_DEADLINE_MS);
    });
    try {
      const creating = Promise.resolve().then(() => {
        const agentDir = maestroAgentDir();
        return this.runtime.createSession({
          target: { providerId: 'openai-codex', modelId: 'gpt-5.6-luna', thinkingLevel: 'low' },
          authPath: maestroAuthPath(), modelsPath: maestroModelsPath(), agentDir, cwd: agentDir,
          scope: 'summarize', tools: [], builtinTools: [], systemPrompt: SESSION_TITLE_SKILL.systemPrompt
        });
      }).then(created => {
        if (ended) { void abortTitleSession(created); return undefined; }
        session = created;
        return created;
      });
      const current = await Promise.race([creating, deadline]);
      if (!current) return { ok: false };
      let output = '';
      let completed = false;
      let invalid = false;
      let rejectOutput: () => void = () => undefined;
      const invalidOutput = new Promise<never>((_resolve, reject) => {
        rejectOutput = () => { invalid = true; reject(new Error('invalid-title-output')); };
      });
      void invalidOutput.catch(() => undefined);
      unsubscribe = current.subscribe(event => {
        if (ended || invalid) return;
        if (event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'compaction_start') {
          rejectOutput();
        } else if (event.type === 'text_delta') {
          if (output.length + event.delta.length > OUTPUT_LIMIT) rejectOutput();
          else output += event.delta;
        } else if (event.type === 'assistant_done' || event.type === 'assistant_message_end') {
          if (event.errorMessage || (event.stopReason && event.stopReason !== 'stop')) { rejectOutput(); return; }
          completed = true;
          if (event.text) {
            if (event.text.length > OUTPUT_LIMIT) rejectOutput();
            else output = event.text;
          }
        }
      });
      // A terminal event alone is insufficient: the prompt must also finish without later errors.
      await Promise.race([current.prompt({ text: JSON.stringify({ firstMessage: text }) }), deadline, invalidOutput]);
      const title = completed && !invalid ? validateSessionTitle(output) : null;
      return title ? { ok: true, title } : { ok: false };
    } catch {
      return { ok: false };
    } finally {
      ended = true;
      clearTimeout(timer);
      try { unsubscribe?.(); } catch { /* Cleanup must not block subsequent title jobs. */ }
      if (session) await abortTitleSession(session);
    }
  }
}

export const sessionTitleService = new SessionTitleService();
