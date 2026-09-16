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
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workflow visual test fixture</title><style>html,body,#app{height:100%;margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{padding:20px;box-sizing:border-box;background:#edf1f7}#app{overflow:hidden;border-radius:12px;border:1px solid #dce3ed}</style></head><body><div id="app"></div><script type="module" src="/tests/workflowLibrary/visual.fixture.ts"></script></body></html>'
const server = await createServer({ root, configFile: false, optimizeDeps: { entries: ['tests/workflowLibrary/visual.fixture.ts'] }, plugins: [vue(), { name: 'workflow-visual-fixture', configureServer(server) { server.middlewares.use((req,res,next) => { if(req.url === '/') { res.setHeader('Content-Type','text/html'); res.end(html) } else next() }) } }], resolve: { alias: { 'electron-xpc/renderer': resolve(root,'tests/workflowLibrary/xpc.fixture.ts'), '@shared': resolve(root,'src/shared'), '@renderer': resolve(root,'src/renderer') } }, server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const address = server.httpServer.address()
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1260, height: 780 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/`)
  await page.locator('[name="workbench-workflows__item-institution-1"]').click()
  await page.locator('[name="workflow-flow__node-count"]').click()
  await page.locator('[name="workflow-flow__node-summarize"]').focus(); await page.keyboard.press('Enter')
  assert.equal(await page.locator('[name="workflow-flow__node-summarize"]').getAttribute('aria-pressed'), 'true')
  const originalWidth = await page.locator('.workflow-flow__diagram').getAttribute('width')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  assert.notEqual(await page.locator('.workflow-flow__diagram').getAttribute('width'), originalWidth)
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await page.screenshot({ path: resolve(output,'desktop-light.png') })
  await page.evaluate(() => document.body.setAttribute('arco-theme','dark'))
  await page.screenshot({ path: resolve(output,'desktop-dark.png') })
  await page.setViewportSize({ width: 660, height: 860 })
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await page.screenshot({ path: resolve(output,'narrow-dark.png') })
  await page.evaluate(() => document.body.setAttribute('arco-theme','light'))
  await page.screenshot({ path: resolve(output,'narrow-light.png') })
  await page.getByRole('tab', { name: 'Details', exact: true }).click()
  await page.getByText('SHA-256', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Visual behavior passed: selection, keyboard, zoom/fit, details; desktop/narrow light/dark screenshots:', output)
} finally { await browser.close(); await server.close() }
