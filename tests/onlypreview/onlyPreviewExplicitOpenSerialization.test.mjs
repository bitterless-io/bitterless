/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { runtime, source } from './onlyPreviewCoreTest.helper.mjs';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const tick = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

test('explicit Preview opens execute FIFO and each caller awaits its own operation', async () => {
  const firstGate = deferred();
  const calls = [];
  const open = runtime.serializeOnlyPreviewOpenTarget(async (target) => {
    calls.push(`start:${target}`);
    if (target === '/tmp/first.md') await firstGate.promise;
    calls.push(`end:${target}`);
  });

  const first = open('/tmp/first.md');
  const second = open('/tmp/second.md');
  let secondSettled = false;
  void second.finally(() => {
    secondSettled = true;
  });

  await tick();
  assert.deepEqual(calls, ['start:/tmp/first.md']);
  assert.equal(secondSettled, false);

  firstGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, [
    'start:/tmp/first.md',
    'end:/tmp/first.md',
    'start:/tmp/second.md',
    'end:/tmp/second.md'
  ]);
});

test('a failed explicit Preview open rejects only its caller and does not poison the FIFO', async () => {
  const calls = [];
  const open = runtime.serializeOnlyPreviewOpenTarget(async (target) => {
    calls.push(target);
    if (target === '/tmp/rejected.md') throw new Error('fixture open failed');
  });

  const rejected = open('/tmp/rejected.md');
  const continued = open('/tmp/continued.md');
  await assert.rejects(rejected, /fixture open failed/);
  await continued;
  assert.deepEqual(calls, ['/tmp/rejected.md', '/tmp/continued.md']);
});

test('folder selection mutations and explicit file opens share the same FIFO', async () => {
  const folderGate = deferred();
  const calls = [];
  const mutations = new runtime.OnlyPreviewTargetMutationQueue();
  const folder = mutations.run(async () => {
    calls.push('start:folder');
    await folderGate.promise;
    calls.push('end:folder');
    return 'folder-workspace';
  });
  const openFile = runtime.serializeOnlyPreviewOpenTarget(async (target) => {
    calls.push(`file:${target}`);
  }, mutations);
  const file = openFile('/tmp/external.md');

  await tick();
  assert.deepEqual(calls, ['start:folder']);
  folderGate.resolve();
  assert.equal(await folder, 'folder-workspace');
  await file;
  assert.deepEqual(calls, ['start:folder', 'end:folder', 'file:/tmp/external.md']);
});

test('explicit diagnostics start before FIFO wait and mark dequeue in serialized order', async () => {
  const firstGate = deferred();
  const events = [];
  const serialized = runtime.serializeOnlyPreviewOpenTarget(async (target, trace) => {
    trace.mark('fifo');
    events.push(`dequeue:${target}`);
    if (target.endsWith('first.md')) await firstGate.promise;
  });
  const open = (target) => {
    const trace = { mark: (phase) => events.push(`${phase}:${target}`) };
    events.push(`request:${target}`);
    return serialized(target, trace);
  };

  const first = open('/tmp/first.md');
  const second = open('/tmp/second.md');
  await tick();
  assert.deepEqual(events, [
    'request:/tmp/first.md',
    'request:/tmp/second.md',
    'fifo:/tmp/first.md',
    'dequeue:/tmp/first.md'
  ]);
  firstGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events.slice(-2), ['fifo:/tmp/second.md', 'dequeue:/tmp/second.md']);
});

test('all explicit target sources use the serialized boundary and packaged switches stay explicit', () => {
  const targetA = resolve('/tmp', 'one.txt');
  const targetB = resolve('/tmp', 'two.txt');
  assert.deepEqual(
    runtime.resolveOnlyPreviewOpenTargets(
      [
        '/Applications/Bitterless',
        `--onlypreview-open=${targetA}`,
        '--onlypreview-open=relative.txt',
        `--onlypreview-open=${targetA}`
      ],
      { packaged: true, platform: 'darwin' }
    ),
    [targetA]
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewOpenTargets(
      [
        '/Program Files/Bitterless/Bitterless.exe',
        '--user-data-dir',
        '/profile',
        `--onlypreview-open=${targetB}`,
        '--onlypreview-open=ignored-relative.txt',
        'relative.txt'
      ],
      { packaged: true, platform: 'win32', workingDirectory: '/fixtures' }
    ),
    [targetB, '/fixtures/relative.txt']
  );

  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const explicitService = source('src/main/onlypreview/onlyPreviewExplicitOpen.service.ts');
  const appMain = source('src/main/app.main.ts');
  const explicitOpenBody = explicitService;
  assert.match(explicitOpenBody, /beginExplicitTarget\(\)[\s\S]*ensureStandalone\('explicit'\)/);
  assert.doesNotMatch(explicitOpenBody, /absoluteTargetGeneration|requestGeneration/);
  assert.match(
    handler,
    /export \{ openOnlyPreviewAbsoluteTarget \} from '@main\/onlypreview\/onlyPreviewExplicitOpen\.service';/
  );
  assert.match(
    explicitOpenBody,
    /serializedOpenOnlyPreviewAbsoluteTarget = serializeOnlyPreviewOpenTarget\([\s\S]*performOpenOnlyPreviewAbsoluteTarget,[\s\S]*onlyPreviewTargetMutations[\s\S]*openOnlyPreviewAbsoluteTarget[\s\S]*onlyPreviewOpenDiagnostics\.trace[\s\S]*serializedOpenOnlyPreviewAbsoluteTarget\(target, trace\)[\s\S]*registerOnlyPreviewExplicitTarget\(openOnlyPreviewAbsoluteTarget\)/
  );
  const chooseFolderBody = handler.slice(
    handler.indexOf('async chooseFolder('),
    handler.indexOf('async restoreWorkspace(')
  );
  assert.ok(
    chooseFolderBody.indexOf('dialog.showOpenDialog') <
      chooseFolderBody.indexOf('onlyPreviewTargetMutations.run'),
    'the user dialog must not occupy the target mutation FIFO'
  );
  assert.match(
    chooseFolderBody,
    /onlyPreviewTargetMutations\.run[\s\S]*beginExplicitTarget[\s\S]*openExplicitTarget/
  );
  assert.match(
    appMain,
    /new OnlyPreviewOpenQueue\(openOnlyPreviewAbsoluteTarget\)[\s\S]*mcpBridgeServer\.configurePreviewOpener\(openOnlyPreviewAbsoluteTarget\)/
  );
});
