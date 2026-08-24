import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type {
  ClaudeCompletedResponse,
  ClaudeDecision,
  ClaudeOpenAiUsage,
  ClaudeResponseFunctionCall,
  ClaudeResponseMessage,
  ClaudeUsageEnvelope
} from '@shared/claudeSubscription/claudeSubscription.contract';

const tokenCount = (value: unknown): number => {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

export const normalizeClaudeUsage = (raw: ClaudeUsageEnvelope = {}): ClaudeOpenAiUsage => {
  const modelTotals = Object.values(raw.modelUsage ?? {}).reduce<{
    input: number;
    cached: number;
    output: number;
  }>(
    (totals, usage) => {
      if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return totals;
      const record = usage as Record<string, unknown>;
      totals.input += tokenCount(record.inputTokens);
      totals.cached += tokenCount(record.cacheReadInputTokens);
      totals.output += tokenCount(record.outputTokens);
      return totals;
    },
    { input: 0, cached: 0, output: 0 }
  );
  const usage = raw.usage ?? {};
  const input = tokenCount(usage.input_tokens ?? modelTotals.input);
  const cached = tokenCount(usage.cache_read_input_tokens ?? modelTotals.cached);
  const output = tokenCount(usage.output_tokens ?? modelTotals.output);

  return {
    input_tokens: input + cached,
    input_tokens_details: { cached_tokens: cached },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: input + cached + output
  };
};

export interface ClaudeCompletedResponseOptions {
  createId?: () => string;
  now?: () => number;
}

export const makeClaudeCompletedResponse = (
  model: string,
  decision: ClaudeDecision,
  usage: ClaudeOpenAiUsage,
  options: ClaudeCompletedResponseOptions = {}
): ClaudeCompletedResponse => {
  const createId = options.createId ?? randomUUID;
  const identifier = (prefix: string): string => `${prefix}_${createId().replaceAll('-', '')}`;
  const output: ClaudeResponseMessage | ClaudeResponseFunctionCall =
    decision.action === 'final'
      ? {
          id: identifier('msg'),
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: decision.text,
              annotations: [],
              logprobs: []
            }
          ]
        }
      : {
          id: identifier('fc'),
          type: 'function_call',
          status: 'completed',
          call_id: identifier('call'),
          name: decision.toolName,
          ...(decision.toolNamespace ? { namespace: decision.toolNamespace } : {}),
          arguments: decision.argumentsJson
        };

  return {
    id: identifier('resp'),
    object: 'response',
    created_at: Math.floor((options.now ?? Date.now)() / 1_000),
    status: 'completed',
    error: null,
    incomplete_details: null,
    model,
    output: [output],
    parallel_tool_calls: false,
    tool_choice: 'auto',
    tools: [],
    usage
  };
};

export type ClaudeResponseStreamEvent = Record<string, unknown> & {
  type: string;
  sequence_number: number;
};

export const buildClaudeResponseEvents = (
  response: ClaudeCompletedResponse
): ClaudeResponseStreamEvent[] => {
  let sequenceNumber = 0;
  const events: ClaudeResponseStreamEvent[] = [];
  const emit = (event: Record<string, unknown> & { type: string }): void => {
    events.push({ ...event, sequence_number: sequenceNumber++ });
  };

  emit({
    type: 'response.created',
    response: { ...response, status: 'in_progress', output: [], usage: null }
  });

  const item = response.output[0];
  if (item.type === 'message') {
    const part = item.content[0];
    emit({
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] }
    });
    emit({
      type: 'response.content_part.added',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { ...part, text: '' }
    });
    emit({
      type: 'response.output_text.delta',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: part.text,
      logprobs: []
    });
    emit({
      type: 'response.output_text.done',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: part.text,
      logprobs: []
    });
    emit({
      type: 'response.content_part.done',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part
    });
    emit({ type: 'response.output_item.done', output_index: 0, item });
  } else {
    emit({
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', arguments: '' }
    });
    emit({
      type: 'response.function_call_arguments.delta',
      item_id: item.id,
      output_index: 0,
      delta: item.arguments
    });
    emit({
      type: 'response.function_call_arguments.done',
      item_id: item.id,
      output_index: 0,
      name: item.name,
      arguments: item.arguments
    });
    emit({ type: 'response.output_item.done', output_index: 0, item });
  }

  emit({ type: 'response.completed', response });
  return events;
};

export const writeClaudeResponsesStream = (
  response: ServerResponse,
  completedResponse: ClaudeCompletedResponse
): void => {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  response.flushHeaders();

  for (const event of buildClaudeResponseEvents(completedResponse)) {
    if (response.destroyed || response.writableEnded) return;
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (!response.destroyed && !response.writableEnded) response.end('data: [DONE]\n\n');
};
