/**
 * maestro 树那一份文件引用识别的守卫。
 *
 * 它是宿主 `onlyPreviewLine.shared.ts` 的**有意副本**(别名边界禁止 maestro 引用 `@shared/onlypreview/*`),
 * 所以两边会漂移 —— 这个测试钉住的是「maestro 这一份自己仍然是对的」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'

const jiti = createJiti(import.meta.url, { fsCache: false })
const { normalizeOnlyPreviewLine, linkifyOnlyPreviewReferences, parseOnlyPreviewReferenceHref } =
  await jiti.import(fileURLToPath(new URL('../../src/shared/maestro/fileReference.service.ts', import.meta.url)))

test('maestro 那一份:行号规范化与宿主一致', () => {
  for (const bad of [undefined, null, '', 0, -1, 1.5, NaN, 'abc']) {
    assert.equal(normalizeOnlyPreviewLine(bad), undefined)
  }
  assert.equal(normalizeOnlyPreviewLine('340'), 340)
})

test('maestro 那一份:linkify 认引用、避开代码块', () => {
  assert.equal(
    linkifyOnlyPreviewReferences('see /a/b/http.ts:340 now'),
    'see [/a/b/http.ts:340](onlypreview-ref:%2Fa%2Fb%2Fhttp.ts?line=340) now'
  )
  const fenced = '```\n/a/b/http.ts:340\n```'
  assert.equal(linkifyOnlyPreviewReferences(fenced), fenced)
})

test('maestro 那一份:href 可还原', () => {
  assert.deepEqual(parseOnlyPreviewReferenceHref('onlypreview-ref:%2Fa%2Fb.ts?line=12'), { path: '/a/b.ts', line: 12 })
  assert.equal(parseOnlyPreviewReferenceHref('https://example.com'), null)
})
