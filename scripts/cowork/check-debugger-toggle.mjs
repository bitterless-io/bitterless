import { readCowork as read } from './_harness.mjs'
const assert = (condition, message) => {
  if (!condition) {
    console.error(`[check-debugger-toggle] ${message}`)
    process.exit(1)
  }
}

const api = read('shared/coach.api.ts')
const handler = read('main/xpc/coach.handler.ts')
const capture = read('main/capture/debuggerCapture.ts')
const cowork = read('main/windows/coworkWindow.helper.ts')
const menu = read('renderer/home/src/components/MenuBar/MenuBar.vue')
const tabStore = read('renderer/home/src/components/MenuBar/tab.store.ts')

assert(api.includes('setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]>'), 'XPC contract should expose setTabDebugger')
assert(api.includes('debuggerEnabled: boolean'), 'TabInfo should expose debuggerEnabled')
assert(api.includes('debuggerAttached: boolean'), 'TabInfo should expose debuggerAttached')
assert(handler.includes('async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]>'), 'handler should implement setTabDebugger')
assert(handler.includes('coworkWindowHelper.setTabDebugger(params)'), 'handler should delegate setTabDebugger')

assert(capture.includes('suspend(): void'), 'DebuggerCapture should support suspend')
assert(capture.includes('async resume(): Promise<void>'), 'DebuggerCapture should support resume')
assert(capture.includes('isAttached(): boolean'), 'DebuggerCapture should report live attach state')
assert(capture.includes('if (this.suspended || !this.attached || this.recording || this.wc.isDestroyed()) return'), 'recording should no-op while suspended')

assert(cowork.includes('debuggerEnabled: true'), 'new tabs should default debuggerEnabled true')
assert(cowork.includes('async setTabDebugger(params: { id: string; enabled: boolean }): Promise<TabInfo[]>'), 'main helper should implement setTabDebugger')
assert(cowork.includes('tab.capture.suspend()'), 'turning debugger off should suspend capture')
assert(cowork.includes('await tab.capture.resume()'), 'turning debugger on should resume capture')
assert(cowork.includes('debuggerAttached: Boolean(t.capture?.isAttached())'), 'tab broadcasts should include live attach state')
assert(!/welladjust/i.test(cowork), 'debugger toggle should stay manual, with no WellAdjust-specific auto rule')

assert(tabStore.includes('async toggleActiveDebugger(): Promise<void>'), 'tab store should expose toggleActiveDebugger')
assert(tabStore.includes('coach.setTabDebugger({ id: tab.id, enabled: !tab.debuggerEnabled })'), 'tab store should toggle active tab debugger')
assert(menu.includes('IconBug') && menu.includes('IconBugOff'), 'MenuBar should render debugger icons')
assert(menu.includes('@click="tabStore.toggleActiveDebugger()"'), 'MenuBar should wire debugger button')
assert(menu.includes('Turn Debugger on before capture'), 'capture button should explain debugger-off state')

console.log('[check-debugger-toggle] ok')
