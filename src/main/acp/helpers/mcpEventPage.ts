import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { AcpError } from '../core/acpHost.type';

export const MCP_PAGE_BYTES = 1024 * 1024;
export const MCP_TOOL_BYTES = 3 * 1024 * 1024;
export const MCP_EVENT_BYTES = 8 * 1024 * 1024;
export const MCP_EVENT_COUNT = 20_000;
export interface EventReference { index: number; eventId: string; byteLength: number }
export interface EventPage {
  events: SessionUpdate[];
  eventIndices: number[];
  eventReferences: EventReference[];
  fromCursor: number;
  cursor: number;
  hasMore: boolean;
  totalEvents: number;
}
/** Measures the destination MCP envelope, including its nested JSON string escaping. */
export const toolWireBytes = (result: unknown): number => Buffer.byteLength(JSON.stringify({
  jsonrpc: '2.0', id: '', result: { content: [{ type: 'text', text: JSON.stringify(result) }] }
}));
export const eventPage = (events: SessionUpdate[], options: { cursor: number; sourceId: string }): EventPage => {
  const { cursor, sourceId } = options;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > events.length) throw new AcpError(-32602, 'Invalid event cursor');
  const page: EventPage = { events: [], eventIndices: [], eventReferences: [], fromCursor: cursor, cursor, hasMore: false, totalEvents: events.length };
  for (let index = cursor; index < events.length && index - cursor < 200; index += 1) {
    const update = events[index];
    if (toolWireBytes({ events: [update] }) > MCP_PAGE_BYTES - 8192) {
      page.eventReferences.push({ index, eventId: `${sourceId}:${index}`, byteLength: Buffer.byteLength(JSON.stringify(update)) });
    } else {
      page.events.push(update);
      page.eventIndices.push(index);
      if (toolWireBytes(page) > MCP_PAGE_BYTES) { page.events.pop(); page.eventIndices.pop(); break; }
    }
    page.cursor = index + 1;
  }
  page.hasMore = page.cursor < events.length;
  return page;
};
export const readEventFragment = (event: unknown, offset: unknown): Record<string, unknown> => {
  const bytes = Buffer.from(JSON.stringify(event));
  const position = offset ?? 0;
  if (!Number.isSafeInteger(position) || (position as number) < 0 || (position as number) > bytes.length) throw new AcpError(-32602, 'Invalid event byte offset');
  const end = Math.min(bytes.length, (position as number) + 64 * 1024);
  return { encoding: 'base64', mediaType: 'application/json', data: bytes.subarray(position as number, end).toString('base64'), offset: position, nextOffset: end, byteLength: bytes.length, hasMore: end < bytes.length };
};
