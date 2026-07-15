import { expect, test, type RendererName } from '../fixtures/bitterlessApp.fixture'
import { expectAriaSnapshot } from '../helpers/aria'
import type { Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const openButton = (page: Page, appId: string) =>
  page.locator(`[data-mini-app-id="${appId}"]`).getByRole('button', { name: /Open|打开/ })

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
}

const expectRendererLanguage = async (pages: Page[], language: 'en' | 'zh'): Promise<void> => {
  await expect.poll(async () =>
    await Promise.all(pages.map(async (page) => await page.evaluate(() => document.documentElement.lang)))
  ).toEqual(pages.map(() => language))
}

test.describe('Bitterless embedded Maestro baseline', () => {
  test('opens the full Maestro graph as a singleton and keeps host apps usable', async ({ bitterless }) => {
    const { app, hostPage } = bitterless
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(bitterless.userDataDir)
    const hostUrl = hostPage.url().split('#')[0]
    await expect.poll(async () =>
      await hostPage.locator('#app').evaluate((element) => element.childElementCount)
    ).toBeGreaterThan(0)
    await hostPage.evaluate(() => {
      localStorage.setItem('bitterless-desktop-token', 'bitterless-e2e-token')
    })
    await hostPage.goto(`${hostUrl}#/mini-app`)

    const maestroCard = hostPage.locator('[data-mini-app-id="maestro"]')
    await expect(maestroCard).toBeVisible()
    await expect(maestroCard).toContainText('Maestro')
    await expect(openButton(hostPage, 'maestro')).toBeVisible()
    await openButton(hostPage, 'maestro').click()

    const homePage = await bitterless.waitForRenderer('maestroHome')
    const controlPage = await bitterless.waitForRenderer('maestroControl')
    const workbenchPage = await bitterless.waitForRenderer('maestroWorkbench')
    const sqlitePage = await bitterless.waitForRenderer('maestroSqlite')
    const operationPage = await bitterless.waitForOperation()

    await expect(homePage.locator('[title="AI-CRMS"]')).toBeVisible()
    await expect(homePage.locator('.maestro-menu-bar')).toHaveCSS('height', '96px')
    await expectNoHorizontalOverflow(homePage)
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

    await expect(controlPage.getByRole('button', { name: 'Maestro' })).toBeVisible()
    await expect(controlPage.locator('.control-app')).toBeVisible()
    await expectNoHorizontalOverflow(controlPage)
    await expect(controlPage.getByRole('button', { name: 'Connector' })).toBeVisible()
    await expect(controlPage.getByRole('button', { name: 'Demo' })).toBeVisible()
    await expect(controlPage.getByRole('button', { name: 'New chat' })).toBeVisible()
    await expectAriaSnapshot(
      controlPage.locator('[name="maestro__composer__send"]'),
      `
      - button "Send" [disabled]
      `
    )

    await homePage.getByRole('button', { name: 'Show Workbench' }).click()
    await expect(homePage.getByRole('button', { name: 'Hide Workbench' })).toHaveAttribute('aria-pressed', 'true')
    await expect(workbenchPage.locator('.workbench-app')).toBeVisible()
    await expectNoHorizontalOverflow(workbenchPage)
    await expect(workbenchPage.getByRole('heading', { name: 'Maestro Workbench' })).toBeVisible()
    await expectAriaSnapshot(
      workbenchPage.locator('header'),
      `
      - banner:
        - heading "Maestro Workbench" [level=1]
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

    await hostPage.bringToFront()
    await openButton(hostPage, 'todo').click()
    const liveTodoPage = await bitterless.waitForRenderer('todo')
    await expect(liveTodoPage.locator('.todo-app')).toBeVisible()
    await hostPage.goto(`${hostUrl}#/setting`)
    await hostPage.getByText(/General|通用/, { exact: true }).click()
    await hostPage.locator('.general-setting__body label').filter({ hasText: 'English' }).click()
    await expectRendererLanguage(
      [hostPage, liveTodoPage, homePage, controlPage, workbenchPage],
      'en'
    )
    await hostPage.locator('.general-setting__body label').filter({ hasText: '简体中文' }).click()
    await expectRendererLanguage(
      [hostPage, liveTodoPage, homePage, controlPage, workbenchPage],
      'zh'
    )
    await expect(hostPage.getByText('通用', { exact: true })).toBeVisible()
    await expect(liveTodoPage.locator('.menubar__title')).toHaveText('待办')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => /\/todo\/index\.html(?:$|[?#])/.test(window.webContents.getURL()))
        ?.close()
    })
    await expect.poll(() => bitterless.rendererCount('todo')).toBe(0)
    await hostPage.goto(`${hostUrl}#/mini-app`)

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
    const firstMaestroWebContentsIds = await app.evaluate(({ session, webContents }) => {
      const maestroSession = session.fromPartition('persist:bitterless-cowork')
      return webContents.getAllWebContents()
        .filter((contents) => contents.session === maestroSession)
        .map((contents) => contents.id)
    })
    expect(firstMaestroWebContentsIds.length).toBeGreaterThanOrEqual(5)
    for (const name of ['maestroHome', 'maestroControl', 'maestroWorkbench', 'maestroSqlite'] as RendererName[]) {
      expect(bitterless.rendererCount(name), `${name} should have one live renderer`).toBe(1)
    }

    const firstWindow = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().filter((window) =>
        /\/maestro\/home\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
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
      if (!target) throw new Error('Maestro window is unavailable before repeat Open')
      const probe = globalThis as typeof globalThis & { __maestroFocusCalls?: number[] }
      probe.__maestroFocusCalls = []
      const originalFocus = target.focus.bind(target)
      target.focus = () => {
        probe.__maestroFocusCalls?.push(target.id)
        originalFocus()
      }
      return BrowserWindow.getFocusedWindow() != null
    }, firstWindow.id)
    await openButton(hostPage, 'maestro').click()
    await expect.poll(async () =>
      await app.evaluate(({ BrowserWindow }, id) => {
        const windows = BrowserWindow.getAllWindows().filter((window) =>
          /\/maestro\/home\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
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
        const probe = globalThis as typeof globalThis & { __maestroFocusCalls?: number[] }
        return probe.__maestroFocusCalls?.filter((windowId) => windowId === id).length || 0
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
        .find((window) => /\/maestro\/home\/index\.html(?:$|[?#])/.test(window.webContents.getURL()))
        ?.close()
    })
    await expect.poll(() =>
      (['maestroHome', 'maestroControl', 'maestroWorkbench', 'maestroSqlite'] as RendererName[])
        .reduce((sum, name) => sum + bitterless.rendererCount(name), 0)
    ).toBe(0)
    await expect.poll(() => bitterless.operationCount()).toBe(0)
    await expect.poll(() => operationPage.isClosed()).toBe(true)
    await expect.poll(async () =>
      await app.evaluate(({ session, webContents }) => {
        const maestroSession = session.fromPartition('persist:bitterless-cowork')
        return webContents.getAllWebContents()
          .filter((contents) => contents.session === maestroSession)
          .map((contents) => contents.id)
      })
    ).toEqual([])

    await hostPage.bringToFront()
    await expect(hostPage.locator('[data-mini-app-id="todo"]')).toBeVisible()
    await openButton(hostPage, 'todo').click()
    const todoPage = await bitterless.waitForRenderer('todo')
    await expect(todoPage.locator('.todo-app')).toBeVisible()
    await expectRendererLanguage([todoPage], 'zh')
    await expect(todoPage.locator('.menubar__title')).toHaveText('待办')
    expect(bitterless.rendererCount('todo')).toBe(1)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => /\/todo\/index\.html(?:$|[?#])/.test(window.webContents.getURL()))
        ?.close()
    })
    await expect.poll(() => bitterless.rendererCount('todo')).toBe(0)

    await hostPage.bringToFront()
    await openButton(hostPage, 'maestro').click()
    const reopenedHomePage = await bitterless.waitForRenderer('maestroHome')
    const reopenedControlPage = await bitterless.waitForRenderer('maestroControl')
    const reopenedWorkbenchPage = await bitterless.waitForRenderer('maestroWorkbench')
    await bitterless.waitForRenderer('maestroSqlite')
    await bitterless.waitForOperation()
    await expectRendererLanguage(
      [reopenedHomePage, reopenedControlPage, reopenedWorkbenchPage],
      'zh'
    )
    expect(existsSync(sqliteBootstrapFile), 'Maestro reopen must consume its fresh bootstrap token').toBe(false)
    expect(bitterless.operationCount()).toBe(1)
    const reopenedMaestroWebContentsIds = await app.evaluate(({ session, webContents }) => {
      const maestroSession = session.fromPartition('persist:bitterless-cowork')
      return webContents.getAllWebContents()
        .filter((contents) => contents.session === maestroSession)
        .map((contents) => contents.id)
    })
    expect(reopenedMaestroWebContentsIds.some((id) => firstMaestroWebContentsIds.includes(id))).toBe(false)
    for (const name of ['maestroHome', 'maestroControl', 'maestroWorkbench', 'maestroSqlite'] as RendererName[]) {
      expect(bitterless.rendererCount(name), `${name} should not duplicate after reopen`).toBe(1)
    }
    const reopenedWindow = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().filter((window) =>
        /\/maestro\/home\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
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
          'https://unknown.invalid/maestro?token=sentinel'
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
      'GET https://unknown.invalid/default',
      'GET https://unknown.invalid/maestro'
    ])
    expect(deniedLog.join('\n')).not.toContain('sentinel')
    expect(deniedLog.join('\n')).not.toContain('?')
    expect(bitterless.rendererErrors).toEqual([])
  })
})
