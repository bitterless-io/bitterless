// `read_file` 出口闸的契约测试 —— 2000 行 ∧ 50KB,先撞先赢,永不返回半行。
//
// 为什么钉这些:2026-09-22 的一次真实会话里,一份 **150 行**的 HTML 被 `limit: 2000` 放行,
// 单次返回 120,049 字符 / **72,541 token**,其中 96% 是内嵌 base64 字体,而文档正文一个字都没到
// (`overmind:areas/agent-runtime/chat/file-reading.html` #0)。字符闸约束不住 token,行闸约束不住
// "行少字节多"的文件 —— 所以这里逐条钉字节这个维度,以及截断回执里那三件事:
// 读到哪、怎么接着读、不许据此总结。
//
// `readGate.ts` 零 import,所以 esbuild 出来就是一个可 require 的 CJS(`tests/lanIp/*` 的同款做法)。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

// 相对 cwd 的 entryPoint 只在仓库根下跑得动;从子目录跑 esbuild 会报
// `Could not resolve "src/main/maestro/files/readGate.ts"`。从测试文件自身定位,与 Cowork 侧同形。
const projectRoot = resolve(import.meta.dirname, '../..');
const directory = mkdtempSync(join(tmpdir(), 'read-gate-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'readGate.cjs');
buildSync({
  entryPoints: [join(projectRoot, 'src/main/maestro/files/readGate.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile
});
const { applyReadGate, splitLines, formatSize, MAX_READ_LINES, MAX_READ_BYTES } =
  createRequire(import.meta.url)(outfile);

const PATH = '/tmp/deck.html';
const lines = (count, each) => Array.from({ length: count }, () => each).join('\n');

test('与 pi 内置 read 同口径', () => {
  assert.equal(MAX_READ_LINES, 2000);
  assert.equal(MAX_READ_BYTES, 50 * 1024);
  assert.equal(formatSize(51200), '50.0KB');
  assert.equal(formatSize(900), '900B');
});

test('短文件原样返回,不加任何标记', () => {
  const result = applyReadGate('a\nb\nc', PATH);
  assert.equal(result.text, 'a\nb\nc');
  assert.equal(result.truncated, false);
  assert.equal(result.nextOffset, undefined);
});

test('结尾换行不虚报行数', () => {
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines('a\nb'), ['a', 'b']);
  assert.deepEqual(splitLines(''), ['']);
  const result = applyReadGate('a\nb\n', PATH);
  assert.equal(result.text, 'a\nb');
  assert.equal(result.truncated, false);
});

test('行闸:超过 2000 行时在 2000 行停下并给出 offset=2001', () => {
  const result = applyReadGate(lines(2500, 'x'), PATH);
  assert.equal(result.truncated, true);
  assert.equal(result.nextOffset, 2001);
  assert.equal(result.text.split('\n').length, 2000 + 2); // 正文 + 空行 + PARTIAL
  assert.match(result.text, /lines 1-2000 of 2500 \(2000-line limit\)/);
  assert.match(result.text, /offset=2001/);
});

test('字节闸:行数没到 2000 也会因为 50KB 停下', () => {
  // 每行 1KB,100 行 —— 行闸远没到,字节闸在第 50 行附近生效。
  const result = applyReadGate(lines(100, 'y'.repeat(1023)), PATH);
  assert.equal(result.truncated, true);
  assert.match(result.text, /\(50\.0KB limit\)/);
  assert.equal(result.nextOffset, 51);
  assert.ok(Buffer.byteLength(result.text.split('\n\n…[PARTIAL')[0], 'utf8') <= MAX_READ_BYTES);
});

test('永不返回半行', () => {
  const result = applyReadGate(lines(100, 'z'.repeat(1023)), PATH);
  const body = result.text.split('\n\n…[PARTIAL')[0];
  for (const line of body.split('\n')) assert.equal(line.length, 1023);
});

test('单行就超过字节闸 → 不返回内容,给 bash 兜底', () => {
  const content = `head\n${'b'.repeat(64435)}\ntail`;
  const first = applyReadGate(content, PATH);
  // 第 1 行进得去,第 2 行超限 ⇒ 这一页只有第 1 行。
  assert.equal(first.text.split('\n\n…[PARTIAL')[0], 'head');
  assert.equal(first.nextOffset, 2);

  const second = applyReadGate(content, PATH, { offset: 2 });
  assert.equal(second.truncated, true);
  assert.match(second.text, /^\[Line 2 is 62\.9KB, exceeds 50\.0KB limit\./);
  assert.match(second.text, /Use bash: sed -n '2p' \/tmp\/deck\.html \| head -c 51200\]$/);
  assert.ok(!second.text.includes('bbbb'), '超限的那一行本身不许进上下文');
});

test('坐标连续:照着 nextOffset 翻能不重不漏地走完全文', () => {
  const total = 5000;
  const content = lines(total, 'w');
  const seen = [];
  let offset = 1;
  for (let guard = 0; guard < 10; guard += 1) {
    const result = applyReadGate(content, PATH, { offset });
    const body = result.text.split('\n\n…[PARTIAL')[0];
    seen.push(...body.split('\n'));
    if (!result.truncated) break;
    offset = result.nextOffset;
  }
  assert.equal(seen.length, total);
});

test('调用方自己的 limit 先到时不写闸门原因', () => {
  const result = applyReadGate(lines(500, 'q'), PATH, { limit: 10 });
  assert.equal(result.truncated, true);
  assert.equal(result.nextOffset, 11);
  assert.match(result.text, /lines 1-10 of 500\. The REST IS AVAILABLE/);
  assert.ok(!result.text.includes('limit)'), '不该谎称是闸门截的');
});

test('调用方的 limit 大于闸时,闸生效并写明原因', () => {
  const result = applyReadGate(lines(5000, 'q'), PATH, { limit: 4000 });
  assert.equal(result.nextOffset, 2001);
  assert.match(result.text, /\(2000-line limit\)/);
});

test('offset 越界给说明而不是报错', () => {
  const result = applyReadGate('a\nb', PATH, { offset: 99 });
  assert.equal(result.truncated, false);
  assert.equal(result.text, '(file has 2 lines; offset 99 is past the end)');
});

test('截断回执必须同时说清读到哪、怎么接着读、不许据此总结', () => {
  const text = applyReadGate(lines(2500, 'x'), PATH).text;
  assert.match(text, /PARTIAL: lines 1-2000 of 2500/);
  assert.match(text, /call read_file again with offset=2001 to continue/);
  assert.match(text, /Do NOT summarise from this fragment alone/);
});
