import { expect, test, type RendererName } from '../fixtures/bitterlessApp.fixture'
import { expectAriaSnapshot } from '../helpers/aria'
import type { Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const openButton = (page: Page, appId: string) =>
  page.locator(`[data-mini-app-id="${appId}"]`).getByRole('button', { name: /Open|打开/ })

test.describe('Bitterless embedded Cowork baseline', () => {
  test('opens the full Cowork graph as a singleton and keeps host apps usable', async ({ bitterless }) => {
    const { app, hostPage } = bitterless
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(bitterless.userDataDir)
    const hostUrl = hostPage.url().split('#')[0]
    await hostPage.evaluate(() => {
      localStorage.setItem('bitterless-desktop-token', 'bitterless-e2e-token')
    })
    await hostPage.goto(`${hostUrl}#/mini-app`)

    const coworkCard = hostPage.locator('[data-mini-app-id="cowork"]')
    await expect(coworkCard).toBeVisible()
    await expect(coworkCard).toContainText('Cowork')
    await expect(openButton(hostPage, 'cowork')).toBeVisible()
    await openButton(hostPage, 'cowork').click()

    const homePage = await bitterless.waitForRenderer('coworkHome')
    const controlPage = await bitterless.waitForRenderer('coworkControl')
    const workbenchPage = await bitterless.waitForRenderer('coworkWorkbench')
    const sqlitePage = await bitterless.waitForRenderer('coworkSqlite')
    const operationPage = await bitterless.waitForOperation()

    await expect(homePage.locator('[title="AI-CRMS"]')).toBeVisible()
    await expect(homePage.getByRole('button', { name: 'New tab' })).toBeVisible()
    await expect(homePage.getByPlaceholder('Enter address')).toBeVisible()
    await expectAriaSnapshot(
      homePage.locator('[data-slot="nav"]'),
      `
      - button "Back" [disabled]
      - button "Forward" [disabled]
      - button "Reload"
      `
    )
    await expectAriaSnapshot(
      homePage.locator('[data-slot="actions"]'),
      `
      - button /Debugger/:
        - img
      - button /Capture your actions|Stop capture|Turn Debugger on/:
        - img
      - button /Hide panel|Show panel/:
        - img
      - button /Show Workbench|Hide Workbench/:
        - img
      `
    )

    await expect(controlPage.getByRole('button', { name: 'Cowork' })).toBeVisible()
    await expect(controlPage.getByRole('button', { name: 'Connector' })).toBeVisible()
    await expect(controlPage.getByRole('button', { name: 'Demo' })).toBeVisible()
    await expect(controlPage.getByRole('button', { name: 'New chat' })).toBeVisible()
    await expectAriaSnapshot(
      controlPage.locator('[name="cowork__composer__send"]'),
      `
      - button "Send" [disabled]
      `
    )

    await homePage.getByRole('button', { name: 'Show Workbench' }).click()
    await expect(homePage.getByRole('button', { name: 'Hide Workbench' })).toHaveAttribute('aria-pressed', 'true')
    await expect(workbenchPage.getByRole('heading', { name: 'Cowork Workbench' })).toBeVisible()
    await expectAriaSnapshot(
      workbenchPage.locator('header'),
      `
      - banner:
        - heading "Cowork Workbench" [level=1]
        - button "Close Workbench":
          - img
        - navigation:
          - button "Capture"
          - button "Skills"
          - button "Integrations"
          - button "Injections"
          - button "Tools"
          - button "Models"
          - button "About"
          - button "Log"
      `
    )

    expect(await sqlitePage.evaluate(() => document.readyState)).toBe('complete')
    const sqliteBootstrapFile = join(
      bitterless.userDataDir,
      'cowork',
      'config',
      'sqlite-bootstrap-token'
    )
    expect(existsSync(sqliteBootstrapFile), 'SQLite bootstrap token must be consumed once').toBe(false)
    await expect(operationPage.locator('#ai-crms-e2e')).toHaveText('AI-CRMS local E2E mock')
    expect(bitterless.operationCount()).toBe(1)
    const firstCoworkWebContentsIds = await app.evaluate(({ session, webContents }) => {
      const coworkSession = session.fromPartition('persist:bitterless-cowork')
      return webContents.getAllWebContents()
        .filter((contents) => contents.session === coworkSession)
        .map((contents) => contents.id)
    })
    expect(firstCoworkWebContentsIds.length).toBeGreaterThanOrEqual(5)
    for (const name of ['coworkHome', 'coworkControl', 'coworkWorkbench', 'coworkSqlite'] as RendererName[]) {
      expect(bitterless.rendererCount(name), `${name} should have one live renderer`).toBe(1)
    }

    const firstWindow = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().filter((window) =>
        /\/coworkHome\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
      )
      return {
        count: windows.length,
        id: windows[0]?.id || 0,
        visible: windows[0]?.isVisible() || false
      }
    })
    expect(firstWindow.count).toBe(1)
    expect(firstWindow.id).toBeGreaterThan(0)

    await hostPage.bringToFront()
    // BrowserWindow.isFocused() reflects the native window manager, while Playwright's
    // bringToFront() targets Chromium. A background macOS test launch can therefore have zero
    // focused BrowserWindows. Probe the exact existing window's focus() call in every run, and
    // additionally require native focus whenever this launch has an observable focused window.
    const nativeFocusWasObservable = await app.evaluate(({ BrowserWindow }, id) => {
      const target = BrowserWindow.getAllWindows().find((window) => window.id === id)
      if (!target) throw new Error('Cowork window is unavailable before repeat Open')
      const probe = globalThis as typeof globalThis & { __coworkFocusCalls?: number[] }
      probe.__coworkFocusCalls = []
      const originalFocus = target.focus.bind(target)
      target.focus = () => {
        probe.__coworkFocusCalls?.push(target.id)
        originalFocus()
      }
      return BrowserWindow.getFocusedWindow() != null
    }, firstWindow.id)
    await openButton(hostPage, 'cowork').click()
    await expect.poll(async () =>
      await app.evaluate(({ BrowserWindow }, id) => {
        const windows = BrowserWindow.getAllWindows().filter((window) =>
          /\/coworkHome\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
        )
        return {
          count: windows.length,
          id: windows[0]?.id || 0,
          visible: windows[0]?.isVisible() || false,
          same: windows[0]?.id === id
        }
      }, firstWindow.id)
    ).toEqual({ count: 1, id: firstWindow.id, visible: true, same: true })
    await expect.poll(async () =>
      await app.evaluate((_electron, id) => {
        const probe = globalThis as typeof globalThis & { __coworkFocusCalls?: number[] }
        return probe.__coworkFocusCalls?.filter((windowId) => windowId === id).length || 0
      }, firstWindow.id)
    ).toBeGreaterThan(0)
    if (nativeFocusWasObservable) {
      await expect.poll(async () =>
        await app.evaluate(
          ({ BrowserWindow }, id) =>
            BrowserWindow.getAllWindows().find((window) => window.id === id)?.isFocused() || false,
          firstWindow.id
        )
      ).toBe(true)
    }

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => /\/coworkHome\/index\.html(?:$|[?#])/.test(window.webContents.getURL()))
        ?.close()
    })
    await expect.poll(() =>
      (['coworkHome', 'coworkControl', 'coworkWorkbench', 'coworkSqlite'] as RendererName[])
        .reduce((sum, name) => sum + bitterless.rendererCount(name), 0)
    ).toBe(0)
    await expect.poll(() => bitterless.operationCount()).toBe(0)
    await expect.poll(() => operationPage.isClosed()).toBe(true)
    await expect.poll(async () =>
      await app.evaluate(({ session, webContents }) => {
        const coworkSession = session.fromPartition('persist:bitterless-cowork')
        return webContents.getAllWebContents()
          .filter((contents) => contents.session === coworkSession)
          .map((contents) => contents.id)
      })
    ).toEqual([])

    await hostPage.bringToFront()
    await expect(hostPage.locator('[data-mini-app-id="todo"]')).toBeVisible()
    await openButton(hostPage, 'todo').click()
    const todoPage = await bitterless.waitForRenderer('todo')
    await expect(todoPage.locator('.todo-app')).toBeVisible()
    expect(bitterless.rendererCount('todo')).toBe(1)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => /\/todo\/index\.html(?:$|[?#])/.test(window.webContents.getURL()))
        ?.close()
    })
    await expect.poll(() => bitterless.rendererCount('todo')).toBe(0)

    await hostPage.bringToFront()
    await openButton(hostPage, 'cowork').click()
    await bitterless.waitForRenderer('coworkHome')
    await bitterless.waitForRenderer('coworkControl')
    await bitterless.waitForRenderer('coworkWorkbench')
    await bitterless.waitForRenderer('coworkSqlite')
    await bitterless.waitForOperation()
    expect(existsSync(sqliteBootstrapFile), 'Cowork reopen must consume its fresh bootstrap token').toBe(false)
    expect(bitterless.operationCount()).toBe(1)
    const reopenedCoworkWebContentsIds = await app.evaluate(({ session, webContents }) => {
      const coworkSession = session.fromPartition('persist:bitterless-cowork')
      return webContents.getAllWebContents()
        .filter((contents) => contents.session === coworkSession)
        .map((contents) => contents.id)
    })
    expect(reopenedCoworkWebContentsIds.some((id) => firstCoworkWebContentsIds.includes(id))).toBe(false)
    for (const name of ['coworkHome', 'coworkControl', 'coworkWorkbench', 'coworkSqlite'] as RendererName[]) {
      expect(bitterless.rendererCount(name), `${name} should not duplicate after reopen`).toBe(1)
    }
    const reopenedWindow = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().filter((window) =>
        /\/coworkHome\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
      )
      return { count: windows.length, id: windows[0]?.id || 0 }
    })
    expect(reopenedWindow).toEqual({ count: 1, id: expect.any(Number) })
    expect(reopenedWindow.id).not.toBe(firstWindow.id)

    expect(bitterless.mockRequests).toContain('GET /auth/me')
    expect(bitterless.mockRequests).toContain('GET /ai-crms')
    expect(bitterless.unexpectedMockRequests).toEqual([])
    const denied = await app.evaluate(async ({ session }) => {
      const probes = [
        session.defaultSession.fetch('https://unknown.invalid/default?token=sentinel'),
        session.fromPartition('persist:bitterless-cowork').fetch(
          'https://unknown.invalid/cowork?token=sentinel'
        )
      ]
      return await Promise.all(probes.map(async (probe) => {
        try {
          await probe
          return false
        } catch {
          return true
        }
      }))
    })
    expect(denied).toEqual([true, true])
    const deniedLog = bitterless.deniedNetworkRequests()
    expect(deniedLog.sort()).toEqual([
      'GET https://unknown.invalid/cowork',
      'GET https://unknown.invalid/default'
    ])
    expect(deniedLog.join('\n')).not.toContain('sentinel')
    expect(deniedLog.join('\n')).not.toContain('?')
    expect(bitterless.rendererErrors).toEqual([])
  })
})
