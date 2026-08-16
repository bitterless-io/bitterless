/* eslint-disable @typescript-eslint/explicit-function-return-type, no-regex-spaces */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readBusinessLocale = (language) => [
  read(`src/renderer/common/i18n/${language}.ts`),
  read(`src/renderer/common/i18n/${language}Coin.ts`),
  read(`src/renderer/common/i18n/${language}Trench.ts`),
].join('\n');
const sourceFiles = (path) => {
  const absolute = resolve(root, path);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(child) : [child];
  });
};

test('Trench uses one Arco module rail and keeps the count-free INDEX workspace', () => {
  const app = read('src/renderer/coin/src/App.vue');
  const navigation = read(
    'src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.vue',
  );
  const workspace = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue',
  );
  const styles = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.less',
  );
  assert.match(app, /<TrenchModuleNavigation\s*\/>/);
  assert.match(app, /<TrenchIndexWorkspace[\s\S]*?:selected-chain="navigation\.selectedChain"/);
  assert.match(app, /<TrenchersWorkspace v-else-if="navigation\.module === 'trenchers'"\s*\/>/);
  assert.match(app, /<SnipingWorkspace v-else :scope="navigation\.snipingScope"\s*\/>/);
  assert.doesNotMatch(app, /TrenchModuleBar|TrenchRecordWorkspace/);
  assert.match(navigation, /<a-menu\b/);
  assert.match(navigation, /<a-sub-menu key="index"/);
  assert.match(navigation, /<a-sub-menu key="trenchers"/);
  assert.doesNotMatch(workspace, /CA Records|Negative Wallets|Index Wallets/);
  assert.doesNotMatch(workspace, /role="tablist"|role="tab"|trench-index__chain-tab/);
  assert.match(styles, /grid-template-columns:\s*minmax\(320px, 42%\) minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 639px\)/);
  assert.match(styles, /grid-template-rows:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

const contentSecurityPolicy = (html) => {
  const value = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
  assert.ok(value, 'renderer CSP is required');
  return new Map(value.split(';').map((directive) => directive.trim()).filter(Boolean)
    .map((directive) => {
      const [name, ...sources] = directive.split(/\s+/);
      return [name, sources];
    }));
};

test('Coin admits HTTPS images only while built output and another renderer stay locked', () => {
  const sourceCsp = contentSecurityPolicy(read('src/renderer/coin/index.html'));
  assert.deepEqual(sourceCsp.get('img-src'), ["'self'", 'data:', 'https:']);
  assert.deepEqual(sourceCsp.get('default-src'), ["'self'"]);
  assert.deepEqual(sourceCsp.get('script-src'), ["'self'"]);
  assert.deepEqual(sourceCsp.get('connect-src'), ["'none'"]);
  assert.deepEqual(sourceCsp.get('object-src'), ["'none'"]);
  assert.deepEqual(sourceCsp.get('frame-src'), ["'none'"]);
  assert.deepEqual(sourceCsp.get('base-uri'), ["'none'"]);
  assert.deepEqual(sourceCsp.get('form-action'), ["'none'"]);
  assert.equal(sourceCsp.get('img-src')?.includes('http:'), false);

  const builtCsp = contentSecurityPolicy(read('out/renderer/coin/index.html'));
  assert.deepEqual(builtCsp.get('img-src'), ["'self'", 'data:', 'https:']);
  for (const directive of ['connect-src', 'object-src', 'frame-src', 'base-uri', 'form-action']) {
    assert.deepEqual(builtCsp.get(directive), ["'none'"], directive);
  }
  assert.match(builtCsp.get('script-src')?.join(' ') ?? '', /^'self' 'sha256-/);
  assert.equal(builtCsp.get('img-src')?.includes('http:'), false);

  for (const path of ['src/renderer/todo/index.html', 'out/renderer/todo/index.html']) {
    const otherCsp = contentSecurityPolicy(read(path));
    assert.deepEqual(otherCsp.get('img-src'), ["'self'", 'data:'], path);
    assert.equal(otherCsp.get('img-src')?.includes('https:'), false, path);
  }
});

test('wallet avatars keep a 28px fallback and remove only a failed remote image', () => {
  const workspace = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue',
  );
  const styles = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.less',
  );
  assert.match(workspace, /<span\s+v-if="wallet\.avatarUrl"[\s\S]*?name="trench__index__wallet-avatar"/);
  assert.match(workspace, /trenchWalletAvatarInitial\(wallet\.name, wallet\.canonicalAddress\)/);
  assert.match(workspace, /v-if="hasTrenchWalletAvatarImage\(wallet\.avatarUrl, failedAvatarUrls\)"/);
  assert.match(workspace, /alt=""[\s\S]*?referrerpolicy="no-referrer"[\s\S]*?@error="onAvatarError\(wallet\.avatarUrl\)"/);
  assert.match(styles, /\.trench-index__avatar \{[\s\S]*?width: 28px;[\s\S]*?height: 28px;[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.trench-index__avatar-image \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
});

test('all visible INDEX prose comes from the shared English and Chinese locale trees', () => {
  const workspace = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue',
  );
  for (const literal of [
    'Add CA',
    'Reanalyze',
    'Target CAs',
    'Unknown token',
    'Current MC',
    'Building the first INDEX',
    'No INDEX result yet',
    'Add target CA',
    'Contract address',
    'Choose chain explicitly',
    'No successful analysis yet',
  ]) {
    assert.equal(workspace.includes(literal), false, `visible literal must be localized: ${literal}`);
  }
  const en = readBusinessLocale('en');
  const zh = readBusinessLocale('zh');
  assert.match(en, /indexWorkspace:\s*\{/);
  assert.match(zh, /indexWorkspace:\s*\{/);
  for (const key of ['addCa', 'reanalyze', 'targetCas', 'indexWallets', 'errors']) {
    assert.match(en, new RegExp(`\\b${key}:`));
    assert.match(zh, new RegExp(`\\b${key}:`));
  }
});

test('Header Refresh stays a local reread while Reanalyze exclusively starts analysis', () => {
  const header = read('src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue');
  const workspace = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue',
  );
  assert.match(header, /@click="refreshActiveModule"/);
  assert.match(header, /trenchNavigationStore\.module === 'index'[\s\S]*?trenchIndexStore\.refresh\(\)[\s\S]*?trenchPersonStore\.refresh\(\)/);
  assert.match(header, /const refreshPending = computed\(\(\) => \(/);
  assert.doesNotMatch(header.match(/const refreshPending[\s\S]*?\);/)?.[0] ?? '', /analyzing/);
  assert.match(workspace, /name="trench__index__reanalyze"/);
  assert.match(workspace, /@click="reanalyze"/);
  assert.match(workspace, /store\.commandError && !unavailable/);
  assert.match(workspace, /role="alert"/);
});

test('Todo-parity Trench menu exposes one shared GMGN settings recovery surface', () => {
  const app = read('src/renderer/coin/src/App.vue');
  const header = read('src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue');
  const headerStyles = read('src/renderer/coin/src/components/TrenchHeader/TrenchHeader.less');
  const modal = read(
    'src/renderer/coin/src/components/TrenchGmgnSettings/TrenchGmgnSettings.vue',
  );
  const workspace = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue',
  );
  const preload = read('src/preload/trench/trench.preload.ts');
  assert.match(headerStyles, /height: 32px;[\s\S]*?min-height: 32px;[\s\S]*?flex: 0 0 32px;/);
  assert.match(headerStyles, /background-color: #4e5882/);
  assert.match(headerStyles, /\.trench-header__actions \.arco-btn \{[\s\S]*?width: 28px;[\s\S]*?height: 28px;/);
  assert.match(header, /name="trench__header__gmgn-settings"/);
  assert.ok(
    header.indexOf('name="trench__header__refresh"') <
      header.indexOf('name="trench__header__gmgn-settings"'),
    'GMGN settings must follow Refresh',
  );
  assert.equal((app.match(/<TrenchGmgnSettings\s*\/>/g) ?? []).length, 1);
  assert.match(modal, /name="trench__gmgn-settings"/);
  assert.match(modal, /type="password"/);
  assert.doesNotMatch(modal, /trench-io|trench\.db|GMGN_PRIVATE_KEY\s*=/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('coin', Object\.freeze\(\{ resources: gmgnResources \}\)\)/);
  for (const method of [
    'detectGmgn',
    'saveGmgnApiKey',
    'verifyGmgn',
    'openGmgnOfficialLink',
  ]) assert.match(preload, new RegExp(`\\b${method}:`));
  assert.doesNotMatch(preload, /getStatus:|saveService:|connectCodex:|cancelGmgnVerify:/);
  assert.match(workspace, /store\.commandError\.code === 'PROVIDER_UNAVAILABLE'/);
  assert.match(workspace, /dialogErrorCode === 'PROVIDER_UNAVAILABLE'/);
  assert.doesNotMatch(workspace, /dialogErrorCode === '(?:SOURCE_INVALID|TOKEN_NOT_FOUND|INTERNAL)'/);
});

test('Arco navigation is the single local INDEX chain owner with locked ordering and rail colors', () => {
  const navigation = read(
    'src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.vue',
  );
  const navigationStore = read(
    'src/renderer/coin/src/views/navigation/trenchNavigation.store.ts',
  );
  const workspace = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue',
  );
  const styles = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.less',
  );
  const repository = read('src/renderer/trench-io/trenchIo.repository.ts');
  assert.match(navigation, /mode="vertical"/);
  assert.match(navigation, /:selected-keys="\[navigation\.selectedKey\]"/);
  assert.match(navigation, /:default-open-keys="\['index', 'trenchers', 'sniping'\]"/);
  assert.match(navigation, /@menu-item-click="selectMenuItem"/);
  assert.match(navigation, /createTrenchNavigationMenuItemHandler\(navigation\)/);
  assert.ok(navigation.indexOf('key="index:solana"') < navigation.indexOf('key="index:bsc"'));
  assert.ok(navigation.indexOf('key="index:bsc"') < navigation.indexOf('key="index:robinhood"'));
  assert.match(navigationStore, /selectedKey: TrenchNavigationKey = 'index:solana'/);
  assert.doesNotMatch(navigationStore, /client|emitter|fetch|ipc|xpc/i);
  assert.match(workspace, /selectedChain: TrenchChain/);
  assert.doesNotMatch(workspace, /selectedChain = ref/);
  assert.match(workspace, /activeProjection/);
  assert.match(repository, /\(\['solana', 'bsc', 'robinhood'\] as const\)/);
  assert.match(repository, /chain !== 'robinhood'/);
  assert.match(styles, /border-left: 2px solid #14b887/);
  assert.match(styles, /border-left: 2px solid #c89500/);
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient/);
});

test('Trenchers provides cursor master-detail, stable names, CAS edit and confirmed wallet movement', () => {
  const list = read(
    'src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonList.vue',
  );
  const detail = read(
    'src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue',
  );
  const workspace = read(
    'src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.vue',
  );
  const store = read('src/renderer/coin/src/views/trenchers/trenchPerson.store.ts');
  const client = read('src/renderer/coin/src/views/trenchers/trenchPerson.client.ts');
  for (const stableName of [
    'trench__trenchers__search-input',
    'trench__trenchers__person-row',
    'trench__trenchers__previous-page',
    'trench__trenchers__next-page',
  ]) assert.match(list, new RegExp(`name="${stableName}"`));
  for (const stableName of [
    'trench__trenchers__profile',
    'trench__trenchers__edit-profile',
    'trench__trenchers__wallet-row',
    'trench__trenchers__wallet-address',
    'trench__trenchers__move-wallet',
    'trench__trenchers__move-confirmation',
  ]) assert.match(detail, new RegExp(`name="${stableName}"`));
  assert.match(list, /person\.displayName \|\| t\('trench\.trenchers\.anonymous'\)/);
  assert.match(list, /person\.profit\.rankedWalletCount/);
  assert.match(store, /cursor:\s*cursor \|\| undefined/);
  assert.match(store, /previousSelection/);
  assert.match(store, /result\.error\.code === 'CURSOR_STALE'/);
  assert.match(store, /const redirected = await this\.client\.getPerson[\s\S]*?sequence !== this\.listSequence[\s\S]*?detailSequence !== this\.detailSequence/);
  assert.match(store, /parentListSequence !== undefined && parentListSequence !== this\.listSequence/);
  assert.match(store, /expectedRevision = this\.page\?\.revision/);
  assert.match(store, /beginProfileEdit\(\): boolean/);
  assert.match(store, /submitProfileEdit\(\): Promise<boolean>/);
  assert.match(store, /profileDraftRevision = this\.page\.revision/);
  assert.match(store, /this\.profileDraftDisplayName\.trim\(\) \|\| null/);
  assert.match(store, /this\.rebaseProfileDraft\(\)/);
  assert.match(detail, /store\.submitProfileEdit\(\)/);
  assert.doesNotMatch(detail, /\.trim\(\)|Object\.keys\(fields\)|store\.updateProfile\(/);
  assert.match(store, /account\.walletKind !== 'user'/);
  assert.match(store, /expectedCurrentPersonId:\s*candidate\.sourcePersonId/);
  assert.match(store, /advanceMoveWallet\(\): Promise<TrenchWalletMoveAdvanceResult>/);
  assert.match(detail, /store\.advanceMoveWallet\(\)/);
  assert.doesNotMatch(detail, /store\.lookupMoveWallet\(|store\.confirmMoveWallet\(/);
  assert.match(list, /store\.requestPersonDetail\(person\.personId\)/);
  assert.doesNotMatch(list, /defineEmits|\$emit\(/);
  assert.match(workspace, /store\.detailPaneRequested/);
  assert.doesNotMatch(workspace, /@select=|personId/);
  assert.ok(
    detail.indexOf('name="trench__trenchers__back"') <
      detail.indexOf('v-if="store.detailError && !store.detail"'),
    'Back must precede every detail loading/error/empty branch',
  );
  assert.match(detail, /v-if="store\.detailPaneRequested"[\s\S]*?store\.closePersonDetail\(\)/);
  for (const pending of ['profileSubmitPending', 'movePending']) {
    assert.match(detail, new RegExp(`:mask-closable="!store\\.${pending}"`));
    assert.match(detail, new RegExp(`:closable="!store\\.${pending}"`));
    assert.match(detail, new RegExp(`:esc-to-close="!store\\.${pending}"`));
  }
  assert.match(detail, /:on-before-cancel="allowProfileCancel"/);
  assert.match(detail, /const allowProfileCancel = \(\): boolean => !store\.profileSubmitPending/);
  assert.match(detail, /:on-before-cancel="allowMoveCancel"/);
  assert.match(detail, /const allowMoveCancel = \(\): boolean => !store\.movePending/);
  assert.match(detail, /sourceDisplayName \|\| t\('trench\.trenchers\.anonymous'\)/);
  assert.match(detail, /store\.moveCandidate\.sourcePersonId/);
  assert.match(detail, /linkSourceLabel\(store\.moveCandidate\.wallet\.membershipSource\)/);
  assert.match(client, /createXpcRendererEmitter<TrenchPersonApi>\('TrenchHandler'\)/);
  assert.match(client, /TRENCH_PERSON_CHANGED_EVENT/);
  assert.doesNotMatch(
    [list, detail, store, client].join('\n'),
    /better-sqlite|sqlite3|\bINSERT INTO\b|\bUPDATE trench_\b|\bFROM trench_\b|\bfetch\s*\(|XMLHttpRequest|\baxios\b/i,
  );
});

test('Trenchers keeps internal scroll, narrow list-detail switching, and Top-300 rank labels', () => {
  const workspace = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue',
  );
  const styles = read(
    'src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.less',
  );
  const navigationStyles = read(
    'src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.less',
  );
  assert.match(workspace, /String\(wallet\.chainRank\)\.padStart\(3, '0'\)/);
  assert.match(styles, /grid-template-columns:\s*minmax\(260px, 38%\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.trenchers__person-rows,[\s\S]*?\.trenchers__wallet-list[\s\S]*?overflow: auto/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /\.trenchers--detail-open \.trenchers__person-list[\s\S]*?display: none/);
  assert.match(styles, /@media \(max-height: 359px\)/);
  assert.match(navigationStyles, /width: 148px/);
  assert.match(navigationStyles, /@media \(max-width: 559px\)[\s\S]*?width: 112px/);
});

test('all Trenchers prose is shared between English and Chinese locale trees', () => {
  const components = [
    'src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonList.vue',
    'src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue',
    'src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.vue',
    'src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.vue',
  ].map(read).join('\n');
  for (const literal of [
    'Search traders',
    'Anonymous',
    'Move existing Trench wallet',
    'Edit profile',
    'All traders',
  ]) assert.equal(components.includes(literal), false, literal);
  const en = readBusinessLocale('en');
  const zh = readBusinessLocale('zh');
  for (const locale of [en, zh]) {
    assert.match(locale, /navigation:\s*\{/);
    assert.match(locale, /trenchers:\s*\{/);
    for (const key of ['searchPlaceholder', 'anonymous', 'walletAggregate', 'moveWallet', 'errors']) {
      assert.match(locale, new RegExp(`\\b${key}:`));
    }
  }
});

test('Add CA filters opposite-chain rows before the boundary and keeps the selected chain explicit', () => {
  const workspace = read(
    'src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue',
  );
  const helper = read('src/renderer/coin/src/views/index/trenchIndexAddInput.ts');
  const en = readBusinessLocale('en');
  const zh = readBusinessLocale('zh');
  assert.match(workspace, /partitionTrenchIndexAddInput\(caText\.value, selectedChain\.value\)/);
  assert.match(workspace, /partition\.retained\.length === 0/);
  assert.match(helper, /chain: selectedChain/);
  assert.match(helper, /partition\.retained\.length === 0\s*\? null/);
  assert.doesNotMatch(workspace, /trench__index__chain-select/);
  assert.match(en, /ignoredSolana: '\{count\} Solana chain CA\(s\) ignored\.'/);
  assert.match(en, /ignoredBsc: '\{count\} BSC chain CA\(s\) ignored\.'/);
  assert.match(zh, /ignoredSolana: '包含 \{count\} 个 Solana 链的 CA，已忽略。'/);
  assert.match(zh, /ignoredBsc: '包含 \{count\} 个 BSC 链的 CA，已忽略。'/);
});

test('workspace and SQLite contracts are chain-partitioned v2 without mixed flat projections', () => {
  const types = read('src/shared/trench/trenchIndex.type.ts');
  const migration = read('src/renderer/trench-io/trenchIo.migration.ts');
  const normalizer = read('src/main/coin/index/trenchIndex.normalize.ts');
  assert.match(types, /schema: 'bl-trench-index-workspace-v2'/);
  assert.match(types, /chainProjections: TrenchIndexChainProjection\[\]/);
  assert.doesNotMatch(types.match(/interface TrenchIndexWorkspaceSnapshot[\s\S]*?\n\}/)?.[0] ?? '',
    /\n  (targets|wallets):/);
  assert.match(migration, /'run_id', 'wallet_account_id', 'chain', 'chain_rank'/);
  assert.match(migration, /ON trench_index_wallets\(run_id, chain, chain_rank\)/);
  assert.match(normalizer, /\.slice\(0, TRENCH_INDEX_MAX_WALLETS\)/);
  assert.match(normalizer, /chainRank: index \+ 1/);
});

test('hidden trench-io runtime retries boundedly and reports unavailable lifecycle state', () => {
  const service = read('src/main/trench/trenchIoWindow.service.ts');
  assert.match(service, /this\.restartAttempts >= 3/);
  assert.match(service, /if \(!this\.shouldRun\) return/);
  assert.match(service, /client\.ready\(identity\)[\s\S]*?catch/);
  assert.match(service, /this\.broadcast\('unavailable'\)/);
  assert.match(service, /this\.broadcast\(workspace\.value\.jobState\)/);
});

test('Main owns orchestration without SQLite and module tables reference chain accounts only', () => {
  const main = [
    'src/main/coin/index/trenchIndex.orchestrator.ts',
    'src/main/coin/index/trenchIndex.runtime.ts',
    'src/main/security/safeStoragePolicy.service.ts',
    'src/main/trench/trenchIoClient.service.ts',
    'src/main/trench/trenchPersonImport.service.ts',
    'src/main/trench/trenchIoWindow.service.ts',
    'src/main/xpc/trench.handler.ts',
  ].map(read).join('\n');
  assert.doesNotMatch(main, /better-sqlite|sqlite3|\bSELECT\b|\bINSERT INTO\b|\bUPDATE\s+trench_/i);
  const preload = read('src/renderer/trench-io/trenchIo.database.ts');
  assert.match(preload, /better-sqlite3-multiple-ciphers/);

  const migration = read('src/renderer/trench-io/trenchIo.migration.ts');
  const candidates = [...migration.matchAll(
    /CREATE TABLE trench_index_wallet_candidates \(([\s\S]*?)\n  \);/g,
  )].at(-1)?.[1] ?? '';
  const results = [...migration.matchAll(
    /CREATE TABLE trench_index_wallets \(([\s\S]*?)\n  \);/g,
  )].at(-1)?.[1] ?? '';
  for (const table of [candidates, results]) {
    assert.match(table, /wallet_account_id TEXT NOT NULL/);
    assert.doesNotMatch(table, /canonical_address|avatar_url|metadata_json|\baddress TEXT|\bname TEXT|\bnote TEXT/);
  }
  assert.match(migration, /ON trench_wallets\(address_namespace, canonical_address\)/);
  assert.match(migration, /ON trench_wallet_chain_accounts\(wallet_id, chain\)/);
  assert.match(migration, /TRENCH_IO_PERSON_SCHEMA_VERSION_CODE = '260813155644'/);
  assert.match(migration, /TRENCH_IO_SCHEMA_VERSION_CODE = '260813155645'/);
  const personTypes = read('src/shared/trench/trenchPerson.type.ts');
  assert.match(personTypes, /TRENCH_PERSON_CHANGED_EVENT = 'trench\/person-changed'/);
  assert.doesNotMatch(personTypes.match(/interface TrenchPersonChangedEvent[\s\S]*?\n\}/)?.[0] ?? '',
    /personId|walletId|address|note|displayName/);
});

test('trench-io is the exact hidden source, build, XPC, and process identity', () => {
  const required = [
    'src/renderer/trench-io/index.html',
    'src/renderer/trench-io/trenchIo.database.ts',
    'src/renderer/trench-io/trenchIo.migration.ts',
    'src/renderer/trench-io/trenchIo.preload.ts',
    'src/renderer/trench-io/trenchIo.repository.ts',
    'src/renderer/trench-io/trenchIoPassword.service.ts',
    'src/main/trench/trenchIoCapability.registry.ts',
    'src/main/trench/trenchIoClient.service.ts',
    'src/main/trench/trenchIoWindow.service.ts',
    'src/main/xpc/trenchIoSystem.handler.ts',
  ];
  required.forEach((path) => assert.equal(statSync(resolve(root, path)).isFile(), true, path));
  assert.equal(existsSync(resolve(root, 'src/preload/trenchStorage')), false);
  assert.equal(existsSync(resolve(root, 'src/renderer/trenchStorage')), false);

  const config = read('electron.vite.config.ts');
  assert.match(config, /'trench-io': resolve\('src\/renderer\/trench-io\/trenchIo\.preload\.ts'\)/);
  assert.match(config, /'trench-io': resolve\('src\/renderer\/trench-io\/index\.html'\)/);
  const windowService = read('src/main/trench/trenchIoWindow.service.ts');
  for (const contract of [
    /trench-io\/index\.html/,
    /preload\/trench-io\.js/,
    /--trench-io-capability=/,
    /--trench-io-instance=/,
    /sandbox:\s*false/,
    /contextIsolation:\s*true/,
    /nodeIntegration:\s*false/,
    /webSecurity:\s*true/,
    /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/,
    /will-navigate/,
    /will-redirect/,
  ]) assert.match(windowService, contract);

  const identitySources = [
    'electron.vite.config.ts',
    'src/main/app.main.ts',
    'src/main/coin/index/trenchIndex.runtime.ts',
    'src/main/trench/trenchIoCapability.registry.ts',
    'src/main/trench/trenchIoClient.service.ts',
    'src/main/trench/trenchIoWindow.service.ts',
    'src/main/xpc/trenchIoSystem.handler.ts',
    'src/main/xpc/xpc.helper.ts',
    'src/shared/startup/startupDiagnostics.ts',
    'src/shared/trench/trenchIndex.type.ts',
    'src/renderer/common/i18n/en.ts',
    'src/renderer/common/i18n/zh.ts',
    'src/renderer/common/i18n/enTrench.ts',
    'src/renderer/common/i18n/zhTrench.ts',
    ...sourceFiles('src/renderer/trench-io'),
  ].map(read).join('\n');
  assert.doesNotMatch(identitySources, /trenchStorage|TrenchStorage|trench-storage/);
  assert.match(identitySources, /TrenchIoRuntime_/);
  assert.match(identitySources, /TrenchIoSystemHandler/);
  assert.match(identitySources, /\[trench-io\]/);
});

test('typed renderer locale modules stay structurally paired and below the TS file limit', () => {
  const paths = [
    'src/renderer/common/i18n/en.ts',
    'src/renderer/common/i18n/zh.ts',
    'src/renderer/common/i18n/enCoin.ts',
    'src/renderer/common/i18n/zhCoin.ts',
    'src/renderer/common/i18n/enTrench.ts',
    'src/renderer/common/i18n/zhTrench.ts',
  ];
  for (const path of paths) {
    assert.ok(read(path).split('\n').length <= 800, `${path} exceeds 800 lines`);
  }
  assert.match(read('src/renderer/common/i18n/en.ts'), /coin: enCoin,[\s\S]*?trench: enTrench/);
  assert.match(read('src/renderer/common/i18n/zh.ts'), /coin: zhCoin,[\s\S]*?trench: zhTrench/);
  assert.match(read('src/renderer/common/i18n/zhCoin.ts'), /zhCoin: typeof enCoin/);
  assert.match(read('src/renderer/common/i18n/zhTrench.ts'), /zhTrench: typeof enTrench/);
});

test('trench-io document stays CSP-locked and page-empty while native SQL stays preload-only', () => {
  const html = read('src/renderer/trench-io/index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /<body>\s*<\/body>/);
  assert.doesNotMatch(html, /<(script|link|style|img|iframe)\b/i);

  const trenchIoSources = sourceFiles('src/renderer/trench-io')
    .filter((path) => path.endsWith('.ts'));
  const nativeOwners = trenchIoSources.filter((path) => /better-sqlite3-multiple-ciphers/
    .test(read(path)));
  assert.deepEqual(nativeOwners, ['src/renderer/trench-io/trenchIo.database.ts']);
  const mainSources = sourceFiles('src/main')
    .filter((path) => path.endsWith('.ts'))
    .map(read)
    .join('\n');
  assert.doesNotMatch(mainSources, /better-sqlite3-multiple-ciphers/);
});

test('runtime identity migration exposes the exact 13 public trench tools', () => {
  const schema = read('src/shared/trench/trenchMcp.schema.ts');
  const tools = [...schema.matchAll(/name:\s*'(trench\.[^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(tools, [
    'trench.analysis.put',
    'trench.analysis.list',
    'trench.analysis.get',
    'trench.analysis.archive',
    'trench.index_wallet.list',
    'trench.index_wallet.get',
    'trench.negative_wallet.put',
    'trench.negative_wallet.list',
    'trench.negative_wallet.get',
    'trench.negative_wallet_holdings.put',
    'trench.negative_wallet_holdings.get',
    'trench.negative_wallet.archive',
    'trench.person.import',
  ]);
});
