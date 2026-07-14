import { assert, readCowork, readProject } from './_harness.mjs'

const shortcuts = readCowork('main/common/shortcutsHelper/shortcuts.helper.ts')
const windowHelper = readCowork('main/windows/window.helper.ts')
const menuBar = readCowork('renderer/home/src/components/MenuBar/MenuBar.vue')
const menuBarStore = readCowork('renderer/home/src/components/MenuBar/menuBar.store.ts')
const appMain = readProject('src/main/app.main.ts')

assert(shortcuts.includes("app.on('web-contents-created'"), 'Cowork shortcuts should attach to created WebContents')
assert(shortcuts.includes("contents.on('before-input-event'"), 'Cowork shortcuts should use before-input-event')
assert(shortcuts.includes('session.fromPartition(COWORK_PARTITION)'), 'Cowork shortcuts must be scoped to its persistent partition')
assert(shortcuts.includes("key !== 't' && key !== 'w'"), 'embedded shortcuts should handle only tab open/close')
assert(shortcuts.includes('shortcutDedupeMs') && shortcuts.includes('lastShortcutAt'), 'shortcut paths should dedupe one physical keypress')
assert(!shortcuts.includes('globalShortcut'), 'embedded shortcuts must never steal keys from other apps')
assert(!shortcuts.includes("key === 'q'") && !shortcuts.includes('confirmAndQuit'), 'Bitterless must retain quit ownership')
assert(!shortcuts.includes('Menu.setApplicationMenu') && !shortcuts.includes('Menu.buildFromTemplate'), 'Cowork must not replace the host application menu')
assert(appMain.includes("app.on('before-quit'"), 'Bitterless should own the application quit lifecycle')
assert(windowHelper.includes("titleBarStyle: process.platform === 'darwin' ? 'hiddenInset'"), 'Cowork should keep its in-window chrome on macOS')
assert(menuBar.includes("menuBarStore.isMac ? 'pl-[90px]' : 'pl-[18px]'"), 'Cowork chrome should reserve the macOS traffic-light gutter')
assert(menuBar.includes('class="relative z-10 flex h-24 shrink-0 flex-col"'), 'Cowork menu bar should retain its 96px chrome')
assert(menuBarStore.includes('traffic lights overlap') && menuBarStore.includes('reserve a left gutter'), 'Cowork menu store should document its macOS gutter')

console.log('[check-custom-menubar] ok')
