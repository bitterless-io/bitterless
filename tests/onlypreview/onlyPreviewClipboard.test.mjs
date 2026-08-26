import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectOnlyPreviewError, runtime, source } from './onlyPreviewCoreTest.helper.mjs';

const item = {
  realPath: '/tmp/OnlyPreview project/a & b.txt',
  relativePath: 'docs/a & b.txt'
};

test('macOS filesystem copy uses bounded osascript argv while text projections stay in Main', async () => {
  const commands = [];
  const textWrites = [];
  const service = new runtime.OnlyPreviewClipboardService({
    platform: 'darwin',
    executeCommand: async (command) => commands.push(command),
    textClipboard: { writeText: (value) => textWrites.push(value) }
  });

  await service.copyProjectItem(item, 'item');
  await service.copyProjectItem(item, 'absolute-path');
  await service.copyProjectItem(item, 'relative-path');
  await service.copyProjectItem(item, 'name');

  assert.equal(commands.length, 1);
  assert.equal(commands[0].executable, '/usr/bin/osascript');
  assert.equal(commands[0].args.at(-2), '--');
  assert.equal(commands[0].args.at(-1), item.realPath);
  assert.equal(commands[0].args.slice(0, -1).join('\n').includes(item.realPath), false);
  assert.deepEqual(commands[0].options, {
    encoding: 'utf8',
    maxBuffer: runtime.ONLY_PREVIEW_CLIPBOARD_MAX_OUTPUT_BYTES,
    shell: false,
    timeout: runtime.ONLY_PREVIEW_CLIPBOARD_TIMEOUT_MS,
    windowsHide: true
  });
  assert.equal(runtime.ONLY_PREVIEW_CLIPBOARD_TIMEOUT_MS, 5_000);
  assert.equal(runtime.ONLY_PREVIEW_CLIPBOARD_MAX_OUTPUT_BYTES, 16 * 1024);
  assert.deepEqual(textWrites, [item.realPath, item.relativePath, 'a & b.txt']);
  const serviceSource = source('src/main/onlypreview/onlyPreviewClipboard.service.ts');
  assert.doesNotMatch(serviceSource, /readFile|createReadStream|\.read\(/);
  assert.doesNotMatch(serviceSource, /\bexec\(|shell:\s*true/);
});

test('Windows filesystem copy uses fixed STA PowerShell and passes the path only by environment', async () => {
  const commands = [];
  const hostilePath = 'C:\\OnlyPreview\\a"; Remove-Item C:\\safe; #.txt';
  const service = new runtime.OnlyPreviewClipboardService({
    platform: 'win32',
    environment: { SYSTEMROOT: 'C:\\Windows' },
    executeCommand: async (command) => commands.push(command),
    textClipboard: { writeText: () => undefined }
  });

  await service.copyProjectItem(
    { realPath: hostilePath, relativePath: 'a.txt' },
    'item'
  );

  assert.equal(commands.length, 1);
  assert.equal(commands[0].executable, 'powershell.exe');
  assert.deepEqual(commands[0].args.slice(0, 4), [
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-Command'
  ]);
  assert.equal(commands[0].args.join('\n').includes(hostilePath), false);
  assert.match(commands[0].args[4], /Clipboard\]::SetFileDropList/);
  assert.equal(
    commands[0].options.env[runtime.ONLY_PREVIEW_WINDOWS_CLIPBOARD_PATH_ENV],
    hostilePath
  );
  assert.equal(commands[0].options.env.SYSTEMROOT, 'C:\\Windows');
  assert.equal(commands[0].options.timeout, 5_000);
  assert.equal(commands[0].options.maxBuffer, 16 * 1024);
  assert.equal(commands[0].options.shell, false);
});

test('unsupported platforms and helper failures return bounded typed errors without target data', async () => {
  let executions = 0;
  const linux = new runtime.OnlyPreviewClipboardService({
    platform: 'linux',
    executeCommand: async () => {
      executions += 1;
    },
    textClipboard: { writeText: () => undefined }
  });
  await assert.rejects(linux.copyProjectItem(item, 'item'), (error) => {
    assert.equal(expectOnlyPreviewError('OPERATION_FAILED')(error), true);
    assert.equal(error.message.includes(item.realPath), false);
    return true;
  });
  assert.equal(executions, 0);

  const failing = new runtime.OnlyPreviewClipboardService({
    platform: 'darwin',
    executeCommand: async () => {
      throw new Error(`failed: ${item.realPath}`);
    },
    textClipboard: { writeText: () => undefined }
  });
  await assert.rejects(failing.copyProjectItem(item, 'item'), (error) => {
    assert.equal(expectOnlyPreviewError('OPERATION_FAILED')(error), true);
    assert.equal(error.message.includes(item.realPath), false);
    return true;
  });
});

test('filesystem item copy admits only one helper process while text writes remain available', async () => {
  let releaseFirst;
  const commands = [];
  const textWrites = [];
  const firstGate = new Promise((resolveGate) => {
    releaseFirst = resolveGate;
  });
  const service = new runtime.OnlyPreviewClipboardService({
    platform: 'darwin',
    executeCommand: async (command) => {
      commands.push(command);
      await firstGate;
    },
    textClipboard: { writeText: (value) => textWrites.push(value) }
  });

  const first = service.copyProjectItem(item, 'item');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  await service.copyProjectItem(item, 'name');
  await assert.rejects(
    service.copyProjectItem(item, 'item'),
    expectOnlyPreviewError('OPERATION_FAILED')
  );
  assert.equal(commands.length, 1);
  assert.deepEqual(textWrites, ['a & b.txt']);
  releaseFirst();
  await first;
});

test('renderer copy intent accepts only the four shortcut-safe void projections', () => {
  const request = {
    hostToken: 'host-token-clipboard',
    workspaceId: 'workspace-clipboard',
    relativePath: 'docs/a.txt',
    copyKind: 'absolute-path'
  };
  for (const copyKind of ['item', 'absolute-path', 'relative-path', 'name']) {
    assert.deepEqual(runtime.parseOnlyPreviewProjectItemCopyRequest({ ...request, copyKind }), {
      ...request,
      copyKind
    });
  }
  for (const copyKind of ['delete', '', null]) {
    assert.throws(
      () => runtime.parseOnlyPreviewProjectItemCopyRequest({ ...request, copyKind }),
      expectOnlyPreviewError('INVALID_INPUT')
    );
  }
  assert.throws(
    () => runtime.parseOnlyPreviewProjectItemCopyRequest({ ...request, extra: true }),
    expectOnlyPreviewError('INVALID_INPUT')
  );
});
