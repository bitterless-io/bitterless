import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src', 'cowork')
const messageStore = readFileSync(join(root, 'renderer/control/src/store/message.store.ts'), 'utf8')
const controlApp = readFileSync(join(root, 'renderer/control/src/ControlApp.vue'), 'utf8')
const coworkWindow = readFileSync(join(root, 'main/windows/coworkWindow.helper.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const sliceBetween = (source, start, end) => {
  const from = source.indexOf(start)
  assert(from >= 0, `missing start marker: ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert(to > from, `missing end marker after: ${start}`)
  return source.slice(from, to)
}

const assertNoHeavyWork = (source, label) => {
  assert(!source.includes('safeTokenCount('), `${label} should not count tokens`)
  assert(!source.includes('withTokenCount('), `${label} should not update token counts`)
  assert(!source.includes('updateSessionContextUsage('), `${label} should not recompute context usage`)
  assert(!source.includes('persistSession('), `${label} should not persist on every streamed delta`)
}

assert(messageStore.includes('private streamFlushRaf = 0'), 'chat store should track a single stream flush RAF')
assert(messageStore.includes('private scrollNearRaf = 0'), 'chat store should track a single near-bottom scroll RAF')
assert(messageStore.includes('private streamBuffers = markRaw(new Map<string, string>())'), 'stream buffers should avoid deep Vue reactivity')

const pushStream = sliceBetween(messageStore, 'pushStream(payload: AgentStreamDelta): void {', '\n  scrollToBottom(force = false): void')
assert(pushStream.includes('this.streamBuffers.set'), 'stream deltas should be buffered by session')
assert(pushStream.includes('this.scheduleStreamFlush()'), 'stream deltas should schedule a RAF flush')
assertNoHeavyWork(pushStream, 'pushStream')

const scheduleStreamFlush = sliceBetween(messageStore, 'private scheduleStreamFlush(): void {', '\n  private flushStreamBuffers(): void')
assert(scheduleStreamFlush.includes('if (this.streamFlushRaf) return'), 'stream flush should be coalesced')
assert(scheduleStreamFlush.includes('requestAnimationFrame(() => this.flushStreamBuffers())'), 'stream flush should use RAF')

const flushStreamBuffers = sliceBetween(messageStore, 'private flushStreamBuffers(): void {', '\n  private flushStreamBuffer(sessionId: string): void')
assert(flushStreamBuffers.includes('Array.from(this.streamBuffers.entries())'), 'stream flush should batch buffered sessions')
assert(flushStreamBuffers.includes('this.streamBuffers.clear()'), 'stream flush should clear the buffer before appending')
assert(flushStreamBuffers.includes('this.appendStreamDelta(sessionId, delta)'), 'stream flush should append batched deltas')

const appendStreamDelta = sliceBetween(messageStore, 'private appendStreamDelta(sessionId: string, delta: string): void {', '\n  }\n}\n\nexport const messageStore')
assert(appendStreamDelta.includes('last.content += delta'), 'append should only mutate assistant content')
assert(appendStreamDelta.includes('this.scheduleScrollToBottomIfNear()'), 'append should scroll through the coalesced path')
assertNoHeavyWork(appendStreamDelta, 'appendStreamDelta')

const scheduleScroll = sliceBetween(messageStore, 'private scheduleScrollToBottomIfNear(): void {', '\n  private scheduleStreamFlush(): void')
assert(scheduleScroll.includes('if (this.scrollNearRaf) return'), 'near-bottom scroll checks should be coalesced')
assert(scheduleScroll.includes('requestAnimationFrame'), 'near-bottom scroll checks should use RAF')

const finishAssistant = sliceBetween(messageStore, 'private finishAssistant(msg: ChatMessage, full: string): void {', '\n  private cloneWorkspace')
assert(finishAssistant.includes('this.flushStreamBuffer(session.id)'), 'finish should flush any pending streamed text')
assert(finishAssistant.includes('this.withTokenCount(msg)'), 'finish should compute final token count once')

const persistSession = sliceBetween(messageStore, 'async persistSession(session: MessageSession): Promise<void> {', '\n  async chooseWorkspace')
assert(persistSession.includes('this.updateSessionContextUsage(session)'), 'persist should keep context usage accurate at persistence boundaries')

assert(controlApp.includes("xpcRenderer.subscribe('coach/agent-stream'"), 'renderer should subscribe to streamed agent deltas')
assert(coworkWindow.includes("xpcMain.broadcast('coach/agent-stream'"), 'main should broadcast streamed agent deltas')
assert(coworkWindow.includes('const REPLAY_RESPONSE_PREVIEW_LIMIT = 2_000'), 'API replay cards should have a bounded response preview limit')
assert(coworkWindow.includes('responseText: replayResponsePreview(last.data)'), 'browser_exec replay cards should store only response previews')
assert(coworkWindow.includes('responseText: lastApi ? replayResponsePreview(lastApi.result.data) : undefined'), 'skill-script replay cards should store only response previews')
assert(coworkWindow.includes('function replayResponsePreview(value: unknown): string | undefined'), 'response preview formatting should be centralized')

console.log('[check-chat-performance] ok')

