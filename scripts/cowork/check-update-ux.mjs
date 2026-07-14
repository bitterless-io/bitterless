import { assert, readCowork, readProject } from './_harness.mjs'

const adapter = readCowork('main/update/update.service.ts')
const updateStore = readCowork('renderer/home/src/store/update.store.ts')
const menuBar = readCowork('renderer/home/src/components/MenuBar/MenuBar.vue')
const hostUpdateService = readProject('src/main/updateHelper/update.service.ts')
const sharedApi = readCowork('shared/coach.api.ts')

assert(adapter.includes("from '@main/updateHelper/update.service'"), 'Cowork updater must delegate to the Bitterless updater')
assert(adapter.includes('bitterlessUpdateService.manualCheck()'), 'Cowork manual checks should use the host service')
assert(adapter.includes('bitterlessUpdateService.quitAndInstall()'), 'Cowork install should use the host quit lifecycle')
assert(!adapter.includes('electron-updater') && !adapter.includes('setInterval(') && !adapter.includes('fetch('), 'Cowork must not own updater transport or polling')
assert(hostUpdateService.includes("xpcMain.broadcast('coach/update-available'"), 'host updater should publish Cowork update state')
assert(hostUpdateService.includes("xpcMain.broadcast('coach/update-downloaded'"), 'host updater should publish Cowork download completion')
assert(updateStore.includes("xpcRenderer.subscribe('coach/update-available'"), 'Cowork renderer should listen for update availability')
assert(updateStore.includes("xpcRenderer.subscribe('coach/update-downloaded'"), 'Cowork renderer should listen for update completion')
assert(updateStore.includes('downloading = true') && updateStore.includes('downloading = false'), 'Cowork update UI should track download state')
assert(menuBar.includes("updateStore.downloading ? 'Updating' : 'Update'"), 'Cowork menu should display updating/ready state')
assert(menuBar.includes(':disabled="updateStore.downloading"'), 'Cowork update action should be disabled while downloading')
assert(sharedApi.includes("'disabled'"), 'Cowork shared API should support disabled updater status')

console.log('[check-update-ux] ok')
