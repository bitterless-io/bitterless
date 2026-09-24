import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8')

const localHomeSource = source('src/renderer/maestro/localHome/src/LocalHomeApp.vue')
const localHomeStyleSource = source('src/renderer/maestro/localHome/src/localHome.less')
const localHomeRouterSource = source('src/renderer/maestro/localHome/src/localHome.router.ts')
const menuBarSource = source(
  'src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue'
)
const layoutSource = source('src/renderer/maestro/home/src/views/layout/Layout.vue')
const layoutStyleSource = source('src/renderer/maestro/home/src/views/layout/Layout.less')
const workbenchAboutSource = source(
  'src/renderer/maestro/workbench/src/views/WorkbenchAboutView.vue'
)

const bitterlessAssetPath = join(
  projectRoot,
  'src/renderer/maestro/common/assets/icons/bitterless-icon.png'
)
const generatedIconPath = join(projectRoot, 'doc/app_icons/icon64.png')

test('fixed local Home has no left navigation rail and retains its routed content', () => {
  assert.doesNotMatch(localHomeSource, /LocalHomeMenu|a-layout-sider|maestro-local-home__rail/)
  assert.doesNotMatch(localHomeStyleSource, /maestro-local-home-menu|maestro-local-home__rail/)
  assert.match(localHomeSource, /<RouterView/)
  assert.match(localHomeSource, /maestro-local-home__content/)
})

test('dedicated local Settings route remains registered', () => {
  assert.match(localHomeRouterSource, /path: '\/setting'/)
  assert.match(localHomeRouterSource, /name: 'setting'/)
  assert.match(localHomeRouterSource, /component: \(\) => import\('@\/views\/setting\/Setting\.vue'\)/)
  assert.doesNotMatch(localHomeRouterSource, /import Setting from/)
  assert.match(localHomeRouterSource, /props: \{ showChatMenuControl: false \}/)
})

test('fixed Home tab and blank New-tab splash share the Bitterless runtime icon', () => {
  const iconImport =
    /import bitterlessIcon from '@maestro-renderer\/common\/assets\/icons\/bitterless-icon\.png'/

  assert.match(menuBarSource, iconImport)
  assert.match(menuBarSource, /if \(tab\.kind === 'home'\) return bitterlessIcon/)
  assert.doesNotMatch(menuBarSource, /app-logo\.png/)
  assert.match(layoutSource, iconImport)
  assert.match(layoutSource, /<img :src="bitterlessIcon" alt="" class="maestro-layout__logo" \/>/)
  assert.doesNotMatch(layoutSource, /app-logo\.png/)
  assert.match(
    layoutStyleSource,
    /\.maestro-layout__logo \{[\s\S]*?width: 56px;[\s\S]*?height: 56px;/
  )
})

test('ordinary web tabs retain page favicons and the generic fallback', () => {
  assert.match(
    menuBarSource,
    /if \(tab\.favicon && !failedFavicons\.has\(tab\.favicon\)\) return tab\.favicon/
  )
  assert.match(menuBarSource, /return ''/)
  assert.match(menuBarSource, /<IconCommon v-else class="maestro-menu-bar__fallback-icon" \/>/)
  assert.match(menuBarSource, /@error="markFaviconFailed\(tab\.favicon\)"/)
})

test('Workbench About uses the Bitterless runtime icon', () => {
  assert.match(
    workbenchAboutSource,
    /import bitterlessIcon from '@maestro-renderer\/common\/assets\/icons\/bitterless-icon\.png'/
  )
  assert.match(workbenchAboutSource, /:src="bitterlessIcon"/)
  assert.doesNotMatch(workbenchAboutSource, /app-logo\.png/)
})

test('bundled Bitterless runtime icon is byte-identical to the generated 64px icon', () => {
  assert.deepEqual(readFileSync(bitterlessAssetPath), readFileSync(generatedIconPath))
})
