import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(root, 'tmp/workflow-visual')
await mkdir(output, { recursive: true })
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workflow visual test fixture</title><style>html,body,#app{height:100%;margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{padding:20px;box-sizing:border-box;background:#edf1f7}#app{overflow:hidden;border-radius:12px}</style></head><body><div id="app"></div><script type="module" src="/tests/workflowLibrary/visual.fixture.ts"></script></body></html>'
const server = await createServer({ root, configFile: false, optimizeDeps: { entries: ['tests/workflowLibrary/visual.fixture.ts'] }, plugins: [vue(), { name: 'workflow-visual-fixture', configureServer(server) { server.middlewares.use((req,res,next) => { if(req.url === '/') { res.setHeader('Content-Type','text/html'); res.end(html) } else next() }) } }], resolve: { alias: { 'electron-xpc/renderer': resolve(root,'tests/workflowLibrary/xpc.fixture.ts'), '@shared': resolve(root,'src/shared'), '@renderer': resolve(root,'src/renderer') } }, server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const address = server.httpServer.address()
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
// The Flow tab renders PHASES, not a node graph: a dynamic workflow decides its shape from ordinary
// control flow at run time, so there is no static graph to draw, no canvas and no zoom. This test
// used to assert node selection, keyboard focus, zoom/fit, a 200-node layout and a zoom level that
// survived a resize — all of which described a component that no longer ships. What is left is what
// is still real: the phases render in order, the tabs work, and nothing overflows at any width.
try {
  const page = await browser.newPage({ viewport: { width: 1260, height: 780 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/`)
  await page.locator('[name="workbench-workflows__item-text-essentials"]').click()
  await page.locator('[name="workflow-phases__item-1"]').waitFor()
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'the page must never scroll sideways')
  await noOverflow()
  assert.equal(await page.locator('[name="workflow-phases"] li').count(), 3)
  assert.match(await page.locator('[name="workflow-phases__item-1"]').innerText(), /Prepare/i)
  assert.match(await page.locator('[name="workflow-phases__item-3"]').innerText(), /Summarize/i)
  // The note under the list is what stops a reader treating these as a guaranteed execution path.
  assert(await page.locator('.workflow-phases__note').isVisible())
  // The engine badge has to name the engine that actually runs these; it read "Kimchi 0.0.9" for a
  // while after the migration, which is the kind of wrong a screenshot test should have caught.
  assert.match(await page.locator('.workbench-workflows__engine').innerText(), /pi-dynamic-workflows/)
  await page.screenshot({ path: resolve(output,'desktop-light.png') })
  await page.evaluate(() => document.body.setAttribute('arco-theme','dark'))
  await page.screenshot({ path: resolve(output,'desktop-dark.png') })
  await page.setViewportSize({ width: 660, height: 860 })
  await noOverflow()
  await page.screenshot({ path: resolve(output,'narrow-dark.png') })
  await page.evaluate(() => document.body.setAttribute('arco-theme','light'))
  await page.screenshot({ path: resolve(output,'narrow-light.png') })
  await page.getByRole('tab', { name: 'Details', exact: true }).click()
  assert.match(await page.locator('.workbench-workflows__detail, [name="workbench-workflows__detail"]').first().innerText(), /Prepare → Count → Summarize/)
  await page.getByRole('tab', { name: 'Source', exact: true }).click()
  await page.getByText('export const meta', { exact: false }).first().waitFor()
  await page.getByRole('tab', { name: 'Flow', exact: true }).click()
  // A broken package keeps its row and states the reason. Dropping it silently is the failure mode
  // this screen exists to prevent: something is in the folder but nowhere on screen.
  await page.locator('[name="workbench-workflows__item-broken-package"]').click()
  await page.getByText('workflow.mjs is missing', { exact: false }).first().waitFor()
  // A long phase list is the case a fixed-height panel gets wrong — it has to scroll, not overflow.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.workflowVisualPhases(Array.from({ length: 40 }, (_, index) => ({ title: `Phase ${index + 1}`, detail: 'a deliberately long description that has to wrap rather than widen the page' }))))
  await page.locator('[name="workbench-workflows__item-research-review"]').click()
  await page.locator('[name="workflow-phases__item-40"]').waitFor()
  assert.equal(await page.locator('[name="workflow-phases"] li').count(), 40)
  await noOverflow()
  await page.screenshot({ path: resolve(output,'many-phases.png') })
  assert.deepEqual(errors, [])
  console.log('Visual behavior passed: phases in order, phases note, engine badge, tabs, broken package reason, 40-phase fit; desktop/narrow light/dark screenshots:', output)
} finally { await browser.close(); await server.close() }
