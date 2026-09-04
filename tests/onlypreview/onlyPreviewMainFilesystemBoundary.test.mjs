/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const onlyPreviewMainRoot = join(projectRoot, 'src/main/onlypreview');
const retiredIndexPath = join(onlyPreviewMainRoot, 'onlyPreviewIndex.service.ts');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const collectTypeScriptFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });

test('OnlyPreview Main cannot restore the retired traversal service', () => {
  assert.equal(
    existsSync(retiredIndexPath),
    false,
    'the obsolete Main-owned OnlyPreview index module must stay deleted'
  );

  const productionSources = [
    ...collectTypeScriptFiles(onlyPreviewMainRoot),
    join(projectRoot, 'src/main/xpc/onlyPreview.handler.ts')
  ];
  assert.ok(
    productionSources.length > 1,
    'the guard must inspect production OnlyPreview Main code'
  );

  // This guard is intentionally limited to the retired traversal. Tasks 084-087 own the
  // remaining reachable Main filesystem paths and their broader import-boundary proof.
  const retiredServiceReference =
    /\bOnlyPreviewIndexService\b|\bonlyPreviewIndexService\b|onlyPreviewIndex\.service/;
  for (const sourcePath of productionSources) {
    assert.doesNotMatch(
      readFileSync(sourcePath, 'utf8'),
      retiredServiceReference,
      `${relative(projectRoot, sourcePath)} must not reference or instantiate the retired Main index`
    );
  }
});

test('Project native authority and permanent Delete stay in the hidden preload', () => {
  const handler = readFileSync(join(projectRoot, 'src/main/xpc/onlyPreview.handler.ts'), 'utf8');
  const nativeActionsPath = join(onlyPreviewMainRoot, 'onlyPreviewProjectNativeAction.service.ts');
  const nativeActions = readFileSync(nativeActionsPath, 'utf8');
  const workspaceRegistry = readFileSync(
    join(onlyPreviewMainRoot, 'onlyPreviewWorkspace.registry.ts'),
    'utf8'
  );
  const runtimeWindow = readFileSync(
    join(projectRoot, 'src/main/fileSearch/fileSearchWindow.service.ts'),
    'utf8'
  );
  const preloadAuthority = readFileSync(
    join(projectRoot, 'src/preload/fileSearch/fileSearchProjectAuthority.service.ts'),
    'utf8'
  );

  const nativeActionCallGraph = [
    join(projectRoot, 'src/main/xpc/onlyPreview.handler.ts'),
    nativeActionsPath,
    join(onlyPreviewMainRoot, 'onlyPreviewClipboard.service.ts'),
    join(projectRoot, 'src/main/fileSearch/fileSearchWindow.service.ts')
  ];
  for (const sourcePath of nativeActionCallGraph) {
    const productionSource = readFileSync(sourcePath, 'utf8');
    assert.doesNotMatch(
      productionSource,
      /from ['"]node:fs(?:\/promises)?['"]|require\(['"]node:fs(?:\/promises)?['"]\)/,
      `${relative(projectRoot, sourcePath)} must not own filesystem I/O`
    );
    assert.doesNotMatch(
      productionSource,
      /\bunlink(?:Sync)?\s*\(|\bdeleteOpenedFile\b|onlyPreviewWorkspaceRegistry\.openFile/,
      `${relative(projectRoot, sourcePath)} must not open or unlink Project Delete targets`
    );
  }

  assert.doesNotMatch(handler, /deleteOpenedFile|onlyPreviewWorkspaceRegistry\.openFile/);
  assert.doesNotMatch(workspaceRegistry, /\bunlink\s*\(|\bdeleteOpenedFile\b/);
  assert.match(handler, /onlyPreviewProjectNativeActionService/);
  assert.match(nativeActions, /fileSearchWindowService\.prepareProjectDelete/);
  assert.match(nativeActions, /fileSearchWindowService\.commitProjectDelete/);
  assert.match(nativeActions, /\.cancelProjectDelete/);
  assert.match(
    nativeActions,
    /authorizeProjectItem\([\s\S]*requireCurrentItem\(authority\)[\s\S]*shell\.openPath/
  );
  assert.match(
    nativeActions,
    /authorizeProjectItem\([\s\S]*requireCurrentItem\(authority\)[\s\S]*shell\.showItemInFolder/
  );
  assert.match(nativeActions, /workspaceGeneration === expected\.workspaceGeneration/);
  assert.match(preloadAuthority, /await this\.fileOperations\.unlink\(isolated\.entryPath\)/);
  assert.match(runtimeWindow, /--file-search-project-authority-capability=/);
  assert.doesNotMatch(runtimeWindow, /from ['"]node:fs(?:\/promises)?['"]/);
});

test('potentially large Project-content routes delegate real reads to bounded hidden-preload lanes', () => {
  const contentPathFiles = [
    'src/main/xpc/onlyPreview.handler.ts',
    'src/main/fileSearch/fileSearchWindow.service.ts',
    'src/main/fileSearch/fileSearchOfficeReadClient.service.ts',
    'src/main/fileSearch/fileSearchPreviewReadClient.service.ts',
    'src/main/onlypreview/onlyPreviewWorkspace.registry.ts',
    'src/main/onlypreview/onlyPreviewClassifier.service.ts',
    'src/main/onlypreview/onlyPreviewAsset.registry.ts',
    'src/main/onlypreview/onlyPreviewDocument.registry.ts',
    'src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts',
    'src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts',
    'src/main/onlypreview/views/onlyPreviewPreviewReadBroker.service.ts',
    'src/main/onlypreview/views/onlyPreviewSelectionDelivery.service.ts'
  ];
  const forbiddenProjectContentIo =
    /from ['"]node:fs(?:\/promises)?['"]|require\(['"]node:fs(?:\/promises)?['"]\)|\breadFile(?:Sync)?\s*\(|\bcreateReadStream\s*\(|\bcreateWriteStream\s*\(|\bwriteFile(?:Sync)?\s*\(|\bappendFile(?:Sync)?\s*\(|\breaddir(?:Sync)?\s*\(|\bopendir\s*\(|\bunlink(?:Sync)?\s*\(|\bBuffer\.concat\s*\(/;
  for (const relativePath of contentPathFiles) {
    assert.doesNotMatch(
      source(relativePath),
      forbiddenProjectContentIo,
      `${relativePath} must coordinate metadata/capabilities instead of reading project bytes`
    );
  }

  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const delivery = source('src/main/onlypreview/views/onlyPreviewSelectionDelivery.service.ts');
  const asset = source('src/main/onlypreview/onlyPreviewAsset.registry.ts');
  const document = source('src/main/onlypreview/onlyPreviewDocument.registry.ts');
  const broker = source('src/main/onlypreview/views/onlyPreviewPreviewReadBroker.service.ts');
  const runtimeWindow = source('src/main/fileSearch/fileSearchWindow.service.ts');
  const officeClient = source('src/main/fileSearch/fileSearchOfficeReadClient.service.ts');
  const previewClient = source('src/main/fileSearch/fileSearchPreviewReadClient.service.ts');
  const officeReader = source('src/preload/fileSearch/fileSearchOfficeReader.service.ts');
  const previewReader = source('src/preload/fileSearch/fileSearchPreviewReader.service.ts');
  const contentPreload = source('src/preload/onlypreview/onlypreviewContent.preload.ts');
  const officeTypes = source('src/shared/onlypreview/onlyPreviewOfficeReadRuntime.types.ts');
  const previewTypes = source('src/shared/onlypreview/onlyPreviewPreviewReadRuntime.types.ts');
  const previewPolicy = source('src/shared/onlypreview/onlyPreview.types.ts');

  assert.match(region, /fileSearchWindowService\.preparePreviewRead\(\{/);
  assert.match(region, /this\.readBroker\.prepareOfficeSelection\(\{/);
  assert.match(delivery, /onlyPreviewDocumentRegistry\.issue\(/);
  assert.match(delivery, /onlyPreviewAssetRegistry\.issue\(/);
  assert.match(asset, /createOnlyPreviewReadResponse[\s\S]*openPreviewRead\(/);
  assert.match(asset, /readNextPreviewChunk\(\{ \.\.\.identity, offset \}\)/);
  assert.match(document, /inspectPreviewDocumentResource\(\{/);
  assert.match(document, /createOnlyPreviewReadResponse\(\{/);
  assert.match(broker, /fileSearchWindowService\.prepareOfficeRead\(\{/);
  assert.match(broker, /fileSearchWindowService\.readNextOfficeChunk\(\{/);
  assert.match(broker, /fileSearchWindowService\.openPreviewRead\(\{/);
  assert.match(broker, /fileSearchWindowService\.readNextPreviewChunk\(\{/);
  assert.match(runtimeWindow, /this\.officeReader\.readNext\(params\)/);
  assert.match(runtimeWindow, /this\.previewReader\.readNext\(params\)/);

  assert.match(officeReader, /from ['"]node:fs\/promises['"]/);
  assert.match(officeReader, /await active\.handle\.read\(/);
  assert.match(
    officeReader,
    /Math\.min\([\s\S]*ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES[\s\S]*totalBytes - active\.offset/
  );
  assert.match(previewReader, /from ['"]node:fs\/promises['"]/);
  assert.match(previewReader, /await session\.handle\.read\(/);
  assert.match(
    previewReader,
    /Math\.min\(ONLY_PREVIEW_READ_CHUNK_BYTES, session\.end - offset \+ 1\)/
  );

  assert.match(officeClient, /byteLength > ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES/);
  assert.match(officeClient, /value\.totalBytes as number\) > ONLY_PREVIEW_OFFICE_READ_MAX_BYTES/);
  assert.match(previewClient, /value\.bytes\.byteLength > ONLY_PREVIEW_READ_CHUNK_BYTES/);
  assert.match(contentPreload, /opened\.totalBytes > ONLY_PREVIEW_OFFICE_READ_MAX_BYTES/);
  assert.match(contentPreload, /opened\.totalBytes > ONLY_PREVIEW_MAX_TEXT_BYTES/);
  assert.match(officeTypes, /ONLY_PREVIEW_OFFICE_READ_MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(officeTypes, /ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES = 512 \* 1024/);
  assert.match(previewTypes, /ONLY_PREVIEW_READ_CHUNK_BYTES = 512 \* 1024/);
  assert.match(previewPolicy, /ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES = 100 \* 1024 \* 1024/);
  assert.match(previewPolicy, /monaco: 8 \* 1024 \* 1024/);
  assert.match(previewPolicy, /'html-page': 1024 \* 1024/);

  const wholeFileMainAllocation =
    /new Uint8Array\([^\n]*(?:totalBytes|descriptor\.size|prepared\.size)|Buffer\.alloc\([^\n]*(?:totalBytes|descriptor\.size|prepared\.size)|\.arrayBuffer\(\)/;
  for (const mainRelay of [asset, document, broker, runtimeWindow, officeClient, previewClient]) {
    assert.doesNotMatch(mainRelay, wholeFileMainAllocation);
  }
});

test('the large-content guard intentionally leaves bounded Main configuration I/O unchanged', () => {
  const agentSkill = source('src/main/onlypreview/onlyPreviewAgentSkill.service.ts');
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const logSetup = source('src/main/logging/log.setup.ts');

  // Still bounded metadata checks over a fixed file list rather than content reads — only the
  // syscalls moved to fs-extra's promise API, which is this codebase's file I/O style.
  assert.match(agentSkill, /from ['"]node:fs['"]/, 'constants still come from node:fs');
  assert.match(agentSkill, /import \{ access, lstat \} from ['"]fs-extra['"]/);
  assert.doesNotMatch(agentSkill, /Sync\(/, 'no synchronous filesystem call blocks Main');
  assert.match(agentSkill, /await lstat\(/);
  assert.match(agentSkill, /await access\(filePath, constants\.R_OK\)/);
  assert.doesNotMatch(agentSkill, /readFile/, 'the guard reads metadata, never file content');
  assert.match(windowHelper, /windowStateService/);
  assert.match(logSetup, /electron-log/);
});
