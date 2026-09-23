// ══ 接线守卫 ══ 网页下载的落点 + 交还给 agent 的消息(docs/features/browser-downloads.md #4)。
//
// Ral 2026-09-23:「下载资源时应该默认下载到系统下载的目录中,并且在设置中可以修改」/
// 「下载完资源之后,应该把资源下载成功的消息放到上下文中告诉 Agent」。
//
// 行为由 `tests/downloads/downloadManager.test.mjs` 钉;这里钉单测够不着的**接线**:启动时真的
// 装到了两个 session 上、工具汇合点两条路都挂了、设置页真的有这一节。任何一条断掉都不报错 ——
// 下载照样落盘(靠 Electron 兜底),只是 agent 又回到瞎猜路径。
//
// `src/main/net/downloadManager.ts` 与 micromeet-cowork **字节相同**,这里也钉住这一条:
// 两边各改各的,就是 paired 的两份悄悄分叉。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
// 注释里的字面量不能让断言"找到" —— 只看代码。
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const inOrder = (text, ...markers) => {
  let at = -1
  for (const marker of markers) {
    at = text.indexOf(marker, at + 1)
    if (at < 0) return false
  }
  return true
}
const fail = []
const ok = (cond, msg) => { if (!cond) fail.push(msg) }

const managerRaw = read('src/main/net/downloadManager.ts')
const manager = codeOnly(managerRaw)
const exec = codeOnly(read('src/main/agent/runtime/hostToolExecution.ts'))
const appMain = read('src/main/app.main.ts')
const handler = codeOnly(read('src/main/xpc/downloadSettings.handler.ts'))
const barrel = read('src/main/xpc/xpc.helper.ts')
const settings = codeOnly(read('src/main/maestro/settings/coachSettings.service.ts'))
const view = read('src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue')
const en = read('src/renderer/common/i18n/en.ts')
const zh = read('src/renderer/common/i18n/zh.ts')

// ① vendored:与 cowork 字节相同(cowork 在旁边时才比 —— 单独检出本仓时跳过,不假装比过)
const cowork = join(root, '../micromeet-cowork/apps/cowork/src/main/net/downloadManager.ts')
if (existsSync(cowork)) ok(readFileSync(cowork, 'utf8') === managerRaw, 'downloadManager.ts 必须与 micromeet-cowork 字节相同 —— 改一边就同一次改两边')
else console.log('[check-download-destination] micromeet-cowork not checked out next to this repo — byte-identity NOT checked')

// ② 落点:同步 setSavePath,默认系统下载目录
const adopt = (manager.split('export const adoptDownload')[1] || '').split('\n}\n')[0]
ok(inOrder(adopt, 'item.setSavePath(target)', "item.once('done'"), 'adoptDownload 要同步 setSavePath —— 不设的话 Electron 弹保存框')
ok(/app\.getPath\('downloads'\)/.test(manager) && !/~\/Downloads|homedir\(\)/.test(manager), '默认落点取自 app.getPath(\'downloads\'),不许写死')

// ③ 启动时装到两个 session 上,在 startGui 之前
const install = (appMain.split('const installBrowserDownloads')[1] || '').split('\n};')[0]
ok(/configureDownloadManager\(\{ downloadDir: \(\) => settings\.read\(\)\.downloadDir \|\| '' \}\)/.test(install),
   '目录要在下载那一刻读设置 —— 改完不用重启')
ok(/installDownloadManager\(session\.defaultSession, 'default'\)/.test(install), '默认 session 要装')
ok(/installDownloadManager\(session\.fromPartition\(MAESTRO_PARTITION\), MAESTRO_PARTITION\)/.test(install),
   'Maestro 浏览器的 MAESTRO_PARTITION 要装 —— agent 操作的网页全在这里')
ok(!/onlypreview/i.test(codeOnly(install)), 'OnlyPreview 的 session 不装 —— 那里的下载是被刻意拦掉的')
ok(inOrder(appMain, 'installBrowserDownloads();', 'await startGui();'), '要在 startGui() 之前装 —— session 在建 view 时解析')

// ④ 工具汇合点:本仓的签名(signal 直接传)+ 成功与失败两条路
ok(/tool\.execute\(params \|\| \{\}, signal\)\) \+ \(await drainDownloadNote\(\)\)/.test(exec),
   '成功路径要带下载消息,且保持本仓的 execute(params, signal) 签名')
ok(/throw new Error\(error \+ \(await drainDownloadNote\(\)\)\)/.test(exec), '失败路径也要带')

// ⑤ 设置与界面
ok(/normalizeDownloadDir\(value\.downloadDir\)/.test(settings), 'normalizeSettings 逐字段重建 —— 漏了这一行 downloadDir 每次 save 都被丢掉')
ok(/class DownloadSettingsHandler extends XpcMainHandler/.test(handler), '类名两仓一致,渲染端 emitter 字符串才一致')
ok(/new CoachSettingsService\(maestroDataRoot\(\)\)/.test(handler), '读写的是同一份 coach-settings.json(maestroDataRoot)')
ok(/import '\.\/downloadSettings\.handler';/.test(barrel), 'handler 要在 xpc.helper 里 import —— 否则 xpc 答 null')
ok(/if \(picked\.canceled \|\| !picked\.filePaths\[0\]\) return current/.test(handler), '取消选择 = 什么都不改')
ok(/name="general-setting__downloads-section"/.test(view) && /downloadSettingStore\.choose\(\)/.test(view) && /downloadSettingStore\.reset\(\)/.test(view),
   'General 页要有下载目录这一节:选目录 + 恢复默认')
ok(/onMounted\(\(\) => \{\s*void downloadSettingStore\.load\(\);\s*\}\);/.test(codeOnly(view)),
   '下载设置要有自己的 onMounted —— 不许串进 loadSettings(),那条在 Maestro workbench 里会失败')
// 只在 `downloads: { … }` 这一块里找 —— 在整份文件里找的话,后面某个同名键(`change`/`reset`)会冒充它。
const downloadsBlock = (text) => (text.split('      downloads: {')[1] || '').split('\n      },')[0]
for (const key of ['label', 'description', 'folder', 'systemFolder', 'unavailable', 'failed', 'reveal', 'reset', 'change']) {
  const pattern = new RegExp(`\\b${key}: '`)
  ok(pattern.test(downloadsBlock(en)) && pattern.test(downloadsBlock(zh)), `i18n 缺 setting.general.downloads.${key}(en 与 zh 都要有)`)
}

if (fail.length) {
  console.error('[check-download-destination] FAILED')
  for (const f of fail) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('[check-download-destination] ok')
