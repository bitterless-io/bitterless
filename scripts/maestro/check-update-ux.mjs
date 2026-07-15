import { assert, readMaestro, readProject } from './_harness.mjs'

const adapter = readMaestro('main/update/update.service.ts')
const updateStore = readMaestro('renderer/home/src/store/update.store.ts')
const menuBar = readMaestro('renderer/home/src/components/MenuBar/MenuBar.vue')
const hostUpdateService = readProject('src/main/updateHelper/update.service.ts')
const sharedApi = readMaestro('shared/coach.api.ts')

assert(adapter.includes("from '@main/updateHelper/update.service'"), 'Maestro updater must delegate to the Bitterless updater')
assert(adapter.includes('bitterlessUpdateService.manualCheck()'), 'Maestro manual checks should use the host service')
assert(adapter.includes('bitterlessUpdateService.quitAndInstall()'), 'Maestro install should use the host quit lifecycle')
assert(!adapter.includes('electron-updater') && !adapter.includes('setInterval(') && !adapter.includes('fetch('), 'Maestro must not own updater transport or polling')
assert(hostUpdateService.includes("xpcMain.broadcast('coach/update-available'"), 'host updater should publish Maestro update state')
assert(hostUpdateService.includes("xpcMain.broadcast('coach/update-downloaded'"), 'host updater should publish Maestro download completion')
assert(updateStore.includes("xpcRenderer.subscribe('coach/update-available'"), 'Maestro renderer should listen for update availability')
assert(updateStore.includes("xpcRenderer.subscribe('coach/update-downloaded'"), 'Maestro renderer should listen for update completion')
assert(updateStore.includes('downloading = true') && updateStore.includes('downloading = false'), 'Maestro update UI should track download state')
assert(menuBar.includes("updateStore.downloading ? 'Updating' : 'Update'"), 'Maestro menu should display updating/ready state')
assert(menuBar.includes(':disabled="updateStore.downloading"'), 'Maestro update action should be disabled while downloading')
assert(sharedApi.includes("'disabled'"), 'Maestro shared API should support disabled updater status')

console.log('[check-update-ux] ok')
