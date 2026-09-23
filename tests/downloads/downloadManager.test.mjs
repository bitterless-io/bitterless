import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

/**
 * 网页下载的落点 + 交还给 agent 的消息(docs/features/browser-downloads.md)。
 *
 * `src/main/net/downloadManager.ts` 与 micromeet-cowork 字节相同,行为用例在那边的
 * `tests/unit/downloadManager.test.mjs` 里有完整一份;这里钉的是**本仓自己的接缝**:
 * 本仓的 `hostToolExecution`(签名与 cowork 不同:signal 直接传,不包对象)真的挂上了消息,
 * 以及 `CoachSettingsService` 真的把 `downloadDir` 存得住、清得掉 —— `normalizeSettings`
 * 逐字段重建对象,漏一行就是"存了等于没存",而且不报错。
 */
const root = resolve(import.meta.dirname, '../..');
let downloadsDir = mkdtempSync(join(tmpdir(), 'bl-dl-system-'));
const stubs = {
  electron: { app: { getPath: (name) => (name === 'downloads' ? downloadsDir : tmpdir()) } },
  '@maestro-shared/coach.api': { DEFAULT_COACH_START_URL: 'https://example.invalid/' },
  '@maestro-main/llm/llmModels': {
    DEFAULT_PRESET_MODEL: { 'openai-codex': 'gpt-6-astra' },
    LLM_PRESETS: [{ model: 'gpt-6-astra', efforts: [{ id: 'medium' }] }],
    normalizeStoredLlmModel: (_provider, model) => model
  }
};
const load = (() => {
  const cache = new Map();
  const aliases = [
    ['@maestro-main/', 'src/main/maestro/'],
    ['@maestro-shared/', 'src/shared/maestro/'],
    ['@main/', 'src/main/'],
    ['@shared/', 'src/shared/']
  ];
  const read = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const native = createRequire(file);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    });
    const requireFrom = (name) => {
      if (stubs[name]) return stubs[name];
      if (name.startsWith('.')) return read(resolve(dirname(file), `${name}.ts`));
      for (const [prefix, dir] of aliases) {
        if (name.startsWith(prefix)) return read(resolve(root, dir, `${name.slice(prefix.length)}.ts`));
      }
      return native(name);
    };
    new Function('require', 'module', 'exports', outputText)(requireFrom, module, module.exports);
    return module.exports;
  };
  return (path) => read(resolve(root, path));
})();

const manager = load('src/main/net/downloadManager.ts');
const { executeHostTool } = load('src/main/agent/runtime/hostToolExecution.ts');
const { CoachSettingsService, normalizeDownloadDir } = load('src/main/maestro/settings/coachSettings.service.ts');

const fakeItem = (filename) => {
  let done = () => {};
  const item = {
    savePath: '',
    getFilename: () => filename,
    getMimeType: () => 'application/pdf',
    getReceivedBytes: () => 37054,
    getSavePath: () => item.savePath,
    setSavePath: (path) => {
      item.savePath = path;
    },
    once: (event, listener) => {
      if (event === 'done') done = listener;
    },
    finish: (state = 'completed') => {
      if (state === 'completed') writeFileSync(item.savePath, 'pdf');
      done({}, state);
    }
  };
  return item;
};

const fresh = () => {
  manager.resetDownloadLedgerForTests();
  downloadsDir = mkdtempSync(join(tmpdir(), 'bl-dl-system-'));
};

test('默认落点 = 系统下载目录,同步定下', () => {
  fresh();
  const item = fakeItem('Invoice-0CSZ9QB2-0007.pdf');
  manager.adoptDownload(item);
  assert.equal(item.savePath, join(downloadsDir, 'Invoice-0CSZ9QB2-0007.pdf'));
});

test('本仓的 executeHostTool(signal 直接传)成功与失败两条路都带上落地消息', async () => {
  fresh();
  let seenSignal = 'unset';
  const signal = new AbortController().signal;
  const ok = fakeItem('a.pdf');
  manager.adoptDownload(ok);
  ok.finish();
  const success = await executeHostTool({ execute: async (_params, received) => { seenSignal = received; return 'done'; } }, {}, undefined, signal);
  assert.equal(seenSignal, signal, '本仓的签名是把 signal 直接传下去 —— 改接线时不许顺手改成 cowork 的 { signal }');
  assert.match(success.text, /^done/);
  assert.ok(success.text.includes(join(downloadsDir, 'a.pdf')));

  const late = fakeItem('b.pdf');
  manager.adoptDownload(late);
  late.finish();
  await assert.rejects(
    executeHostTool({ execute: async () => { throw new Error('boom'); } }, {}),
    (err) => err.message.startsWith('boom') && err.message.includes(join(downloadsDir, 'b.pdf'))
  );
});

test('台账为空时工具返回原样,一个字都不加', async () => {
  fresh();
  const result = await executeHostTool({ execute: async () => 'plain' }, {});
  assert.equal(result.text, 'plain');
});

test('CoachSettingsService:downloadDir 存得住、清得掉,清掉之后键根本不落盘', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bl-dl-settings-'));
  const service = new CoachSettingsService(dataRoot);
  assert.equal(service.read().downloadDir, undefined);
  service.save({ downloadDir: '/Users/ral/Invoices' });
  assert.equal(service.read().downloadDir, '/Users/ral/Invoices');
  // 存别的字段不许把它冲掉 —— normalizeSettings 逐字段重建,这正是它会悄悄丢的地方。
  service.save({ compactPrompt: 'x' });
  assert.equal(service.read().downloadDir, '/Users/ral/Invoices');
  service.save({ downloadDir: '' });
  assert.equal(service.read().downloadDir, undefined);
  const onDisk = JSON.parse(readFileSync(join(dataRoot, 'coach-settings.json'), 'utf8'));
  assert.equal('downloadDir' in onDisk, false);
});

test('设置归一化:只认绝对路径', () => {
  assert.equal(normalizeDownloadDir('/Users/ral/Invoices'), '/Users/ral/Invoices');
  assert.equal(normalizeDownloadDir('C:\\Users\\ral\\Downloads'), 'C:\\Users\\ral\\Downloads');
  assert.equal(normalizeDownloadDir('Downloads'), undefined);
  assert.equal(normalizeDownloadDir(''), undefined);
  assert.equal(normalizeDownloadDir(null), undefined);
});

test('配的目录不可用 → 回落系统下载目录,且不在设置界面读状态时顺手建目录', () => {
  fresh();
  const gone = join(mkdtempSync(join(tmpdir(), 'bl-dl-gone-')), 'deleted');
  assert.equal(manager.downloadDirAvailable(gone), false);
  assert.equal(existsSync(gone), false);
  const blocker = join(mkdtempSync(join(tmpdir(), 'bl-dl-blocker-')), 'a-file');
  writeFileSync(blocker, 'not a directory');
  manager.configureDownloadManager({ downloadDir: () => join(blocker, 'downloads') });
  assert.deepEqual(manager.resolveDownloadDir(), { dir: downloadsDir, fellBackFrom: join(blocker, 'downloads') });
});
