import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const serviceSource = source('src/main/miniapps/onlypreview/onlyPreviewClipboard.service.ts');
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
  // One environment variable per path plus a matching `$items.Add` line: a single delimited variable
  // would need a separator a Windows filename cannot contain, and there is none.
  assert.equal(
    commands[0].options.env[`${runtime.ONLY_PREVIEW_WINDOWS_CLIPBOARD_PATH_ENV}_0`],
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

test('a multi-selection copies as a list rather than as its first row', async () => {
  const commands = [];
  const written = [];
  const mac = new runtime.OnlyPreviewClipboardService({
    platform: 'darwin',
    executeCommand: async (command) => commands.push(command),
    textClipboard: { writeText: (value) => written.push(value) }
  });
  const items = [
    { realPath: '/w/docs', relativePath: 'docs', name: 'docs' },
    { realPath: '/w/notes/one.md', relativePath: 'notes/one.md', name: 'one.md' }
  ];

  await mac.copyProjectItems(items, 'item');
  assert.equal(commands.length, 1);
  // Paths still travel as argv, never interpolated into the script text.
  assert.deepEqual(commands[0].args.slice(-2), ['/w/docs', '/w/notes/one.md']);
  assert.deepEqual(commands[0].args.slice(0, 2), ['-l', 'JavaScript']);

  await mac.copyProjectItems(items, 'absolute-path');
  await mac.copyProjectItems(items, 'relative-path');
  await mac.copyProjectItems(items, 'name');
  assert.deepEqual(written, [
    '/w/docs\n/w/notes/one.md',
    'docs\nnotes/one.md',
    'docs\none.md'
  ]);
});

test('an empty or oversized selection is refused instead of truncated', async () => {
  const mac = new runtime.OnlyPreviewClipboardService({
    platform: 'darwin',
    executeCommand: async () => undefined,
    textClipboard: { writeText: () => undefined }
  });
  await assert.rejects(mac.copyProjectItems([], 'item'));
  const tooMany = Array.from(
    { length: runtime.ONLY_PREVIEW_MAX_CLIPBOARD_ITEMS + 1 },
    (_unused, index) => ({ realPath: `/w/${index}.md`, relativePath: `${index}.md`, name: `${index}.md` })
  );
  // A silently truncated paste is worse than a refused one: nothing on screen says what was dropped.
  await assert.rejects(mac.copyProjectItems(tooMany, 'absolute-path'));
});

test('macOS copy helper compiles and writes native file URLs to an isolated private pasteboard', {
  skip: process.platform !== 'darwin'
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'onlypreview-native-clipboard-'));
  try {
    const paths = [join(directory, '中文 a & b "quoted".txt'), join(directory, '目录 空格')];
    writeFileSync(paths[0], 'clipboard fixture');
    mkdirSync(paths[1]);
    const command = runtime.createOnlyPreviewClipboardCommand('darwin', paths);
    const script = command.args[command.args.indexOf('-e') + 1];
    const scriptFile = join(directory, 'copy.js');
    writeFileSync(scriptFile, script);
    execFileSync('/usr/bin/osacompile', ['-l', 'JavaScript', '-o', join(directory, 'copy.scpt'), scriptFile], {
      encoding: 'utf8', timeout: 10_000
    });

    // Run the actual writer against a uniquely named pasteboard. The user's general pasteboard is
    // never read or written; only this test's private native resource is released afterwards.
    const privateWriter = script
      .replace('function run(argv)', 'function copyFixture(argv)')
      .replace('$.NSPasteboard.generalPasteboard', 'testPasteboard');
    assert.notEqual(privateWriter, script);
    assert(!privateWriter.includes('generalPasteboard'));
    const fixture = [
      'let testPasteboard;', privateWriter,
      'function run(argv) {',
      '  testPasteboard = $.NSPasteboard.pasteboardWithUniqueName;',
      '  try {',
      '    copyFixture(argv);',
      '    const restored = testPasteboard.readObjectsForClassesOptions($([$.NSURL]), $.NSDictionary.dictionary);',
      '    const paths = [];',
      '    for (let index = 0; index < restored.count; index++) paths.push(ObjC.unwrap(restored.objectAtIndex(index).path));',
      '    return JSON.stringify({ paths, types: ObjC.deepUnwrap(testPasteboard.types) });',
      '  } finally { testPasteboard.releaseGlobally; }',
      '}'
    ].join('\n');
    const result = JSON.parse(execFileSync(command.executable, ['-l', 'JavaScript', '-e', fixture, '--', ...paths], {
      ...command.options, timeout: 10_000
    }));
    assert.deepEqual(result.paths, paths);
    assert(result.types.includes('public.file-url'));
    assert(result.types.includes('NSFilenamesPboardType'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('copy errors preserve their cause and safe helper diagnostics without exposing target paths', async () => {
  const cause = Object.assign(new Error(`command failed with private argv: ${item.realPath}`), {
    code: 1,
    signal: 'SIGTERM',
    stderr: `execution error: cannot copy ${item.realPath}. (-10006)\n`
  });
  const service = new runtime.OnlyPreviewClipboardService({
    platform: 'darwin', executeCommand: async () => { throw cause; },
    textClipboard: { writeText: () => assert.fail('text clipboard must not be used') }
  });
  await assert.rejects(service.copyProjectItem(item, 'item'), (error) => {
    assert.equal(expectOnlyPreviewError('OPERATION_FAILED')(error), true);
    assert.equal(error.cause, cause);
    assert.match(error.message, /code=1/);
    assert.match(error.message, /signal=SIGTERM/);
    assert.match(error.message, /script=-10006/);
    assert(!error.message.includes(item.realPath));
    assert(!Object.keys(error).includes('cause'));
    assert(!JSON.stringify(error).includes(item.realPath));
    return true;
  });
});
