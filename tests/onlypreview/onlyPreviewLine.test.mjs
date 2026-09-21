// 行号是锦上添花,不是打开的前提。
//
// Ral 2026-09-21:「如果有的文件无法进行导航,在指定了行号的情况下,直接忽略即可,不能报错阻塞。」
// 这条决定了整个模块的形状:任何说不清的行号都退化成「没给」,而不是抛错 —— 因为打开文件本身
// 必须永远成功。PDF、图片、docx 没有「第 340 行」,人要的是把文件打开给他看。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'

const jiti = createJiti(import.meta.url, { fsCache: false })
const {
  normalizeOnlyPreviewLine,
  lineWithinDocument,
  findOnlyPreviewReferences,
  linkifyOnlyPreviewReferences,
  parseOnlyPreviewReferenceHref
} =
  await jiti.import(fileURLToPath(new URL('../../src/shared/onlypreview/onlyPreviewLine.shared.ts', import.meta.url)))

test('说不清的行号一律等价于「没给」,而不是抛错', () => {
  for (const bad of [undefined, null, '', 0, -1, 1.5, NaN, Infinity, 'abc', '0', '-3']) {
    assert.equal(normalizeOnlyPreviewLine(bad), undefined, `${String(bad)} 应当被当作没给`)
  }
  assert.equal(normalizeOnlyPreviewLine(340), 340)
  assert.equal(normalizeOnlyPreviewLine('340'), 340, '从文本里解析出来的是字符串')
  assert.equal(normalizeOnlyPreviewLine(' 12 '), 12)
})

test('超出文件行数当作没给 —— 不钳到最后一行', () => {
  assert.equal(lineWithinDocument(340, 280), undefined,
    '钳到末行会让人以为那就是目标,而真相是这个行号不存在')
  assert.equal(lineWithinDocument(280, 280), 280, '最后一行本身是合法的')
  assert.equal(lineWithinDocument(1, 280), 1)
  assert.equal(lineWithinDocument(undefined, 280), undefined)
  assert.equal(lineWithinDocument(5, 0), undefined, '空文件没有任何行')
})

test('认出正文里的 file:line,行号可选', () => {
  const found = findOnlyPreviewReferences(
    '见 /Users/ral/p/src/http.ts:340 和 /Users/ral/p/src/config.ts,另有 /tmp/a.md:7。'
  )
  assert.deepEqual(found.map(r => [r.path, r.line]), [
    ['/Users/ral/p/src/http.ts', 340],
    ['/Users/ral/p/src/config.ts', undefined],
    ['/tmp/a.md', 7]
  ])
})

test('不误伤普通文本 —— 这是它能进正文渲染的前提', () => {
  for (const text of [
    '见第 3 章:12 页',
    'ratio 16:9',
    'http://example.com:8080/x',
    '相对路径 src/http.ts:340 不算',        // 只认绝对路径
    '/Users/ral/p/archive.zip:3'            // 扩展名不在文本类里
  ]) {
    assert.deepEqual(findOnlyPreviewReferences(text), [], `不该匹配:${text}`)
  }
})

test('切分位置准确 —— 渲染层靠它把引用从正文里挖出来', () => {
  const text = 'x /a/b/c.ts:12 y'
  const [ref] = findOnlyPreviewReferences(text)
  assert.equal(text.slice(ref.start, ref.end), '/a/b/c.ts:12')
})

test('反复调用互不干扰 —— 正则的 lastIndex 不能被共用', () => {
  const once = findOnlyPreviewReferences('/a/b.ts:1')
  const twice = findOnlyPreviewReferences('/a/b.ts:1')
  assert.deepEqual(once, twice, '共用一个带 g 标志的实例会让第二次从上次的位置继续')
})

// ——— linkify ———————————————————————————————————————————————————————————————

test('linkify 把 路径:行号 改写成自有 scheme 的链接', () => {
  const out = linkifyOnlyPreviewReferences('see /a/b/http.ts:340 now')
  assert.equal(out, 'see [/a/b/http.ts:340](onlypreview-ref:%2Fa%2Fb%2Fhttp.ts?line=340) now')
})

test('linkify 不碰围栏代码块里的路径', () => {
  const source = '```\nconst p = "/a/b/http.ts:340"\n```'
  assert.equal(linkifyOnlyPreviewReferences(source), source)
})

test('linkify 不碰行内代码和已有链接', () => {
  const inline = 'use `/a/b/http.ts:340` here'
  assert.equal(linkifyOnlyPreviewReferences(inline), inline)
  const linked = '[x](/a/b/http.ts:340)'
  assert.equal(linkifyOnlyPreviewReferences(linked), linked)
})

test('parse 还原 path 与 line,畸形输入返回 null', () => {
  assert.deepEqual(
    parseOnlyPreviewReferenceHref('onlypreview-ref:%2Fa%2Fb.ts?line=12'),
    { path: '/a/b.ts', line: 12 }
  )
  assert.deepEqual(
    parseOnlyPreviewReferenceHref('onlypreview-ref:%2Fa%2Fb.ts'),
    { path: '/a/b.ts', line: undefined }
  )
  assert.equal(parseOnlyPreviewReferenceHref('https://example.com'), null)
  assert.equal(parseOnlyPreviewReferenceHref('onlypreview-ref:%E0%A4%A'), null)
})
