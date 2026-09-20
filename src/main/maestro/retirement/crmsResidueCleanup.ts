import { app } from 'electron';
import { homedir } from 'node:os';
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { ConfigApi } from '@maestro-shared/config.api';
import type { SavedTab, TabsApi } from '@maestro-shared/tabs.api';
import { maestroLegacyPiDir, maestroModelsPath } from '@maestro-main/llm/llmPaths';
import {
  removeCrmsCliCredentials,
  resolveCrmsResiduePaths,
  stripCrmsProviderFromPiModels
} from '@maestro-main/retirement/crmsResidueCleanup.service';

/**
 * AI-CRMS 退役残留清理的 Electron 绑定层 —— 路径来源、DAO 通道、一次性门控。
 *
 * Sunset: 2026-12-31 — 见 docs/features/maestro-crms-retirement.md #6.9
 * 到期删除的账:docs/issues/maestro-crms-residue-cleanup-sunset.md
 */

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao');
const tabsStore = createXpcMainEmitter<TabsApi>('TabsDao');

/**
 * 一次性 marker。domain / key 定义在这里而不是 `config.api.ts`,是为了 sunset 时连它一起删
 * 干净 —— 否则 config 表里会留一个再也没人写的孤儿键(#6.9 落地要求 3)。
 */
const RETIREMENT_CONFIG_DOMAIN = 'maestro-retirement';
const CRMS_RESIDUE_CLEANUP_KEY = 'crms-residue-cleanup';

/** integration 子系统退役后剩下的两个孤儿 domain(#6.7):子系统删了就再没人读得出来。 */
const ORPHAN_CONFIG_DOMAINS = ['integration-targets', 'integration-mappings'];

const CRMS_TAB_HOST = 'crms.micromeet.ai';

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isCrmsTab = (tab: SavedTab): boolean => {
  try {
    // 精确相等,不用 includes('crms') —— 用户可能有别的含这四个字母的书签。用 hostname 而不是
    // host:后者带端口,`crms.micromeet.ai:443` 那样的存量行会漏掉。
    return new URL(tab.url).hostname === CRMS_TAB_HOST;
  } catch {
    // 存量行里什么都可能有;解析不出 URL 的一律不是 CRMS,留着。
    return false;
  }
};

/**
 * 删掉指向 CRMS 的历史 tab 行。
 *
 * 不清它的后果不是「多一个没用的 tab」:`SavedTab` 没有 kind,恢复时会被当普通 tab 打开,而
 * 此时越站防护也随退役删了 —— 等于启动时自动拉起一个裸的远端浏览 tab。
 */
const removeCrmsTabs = async (): Promise<number> => {
  const saved = await tabsStore.listAll();
  const kept = saved.filter((tab) => !isCrmsTab(tab));
  if (kept.length === saved.length) return 0;
  // 重新编号:position 是条带里的次序,中间挖掉一行不补号会留个洞。
  await tabsStore.replaceAll({ tabs: kept.map((tab, position) => ({ ...tab, position })) });
  return saved.length - kept.length;
};

const removeOrphanConfigDomains = async (): Promise<number> => {
  let removed = 0;
  for (const domain of ORPHAN_CONFIG_DOMAINS) {
    const entries = (await configStore.list({ domain })) ?? [];
    for (const entry of entries) {
      await configStore.remove({ domain, key: entry.key });
      removed += 1;
    }
  }
  return removed;
};

const cleanup = async (): Promise<void> => {
  const marker = await configStore.get({ domain: RETIREMENT_CONFIG_DOMAIN, key: CRMS_RESIDUE_CLEANUP_KEY });
  if (marker) return;

  const paths = resolveCrmsResiduePaths({
    piModelsFile: maestroModelsPath(),
    legacyPiDir: maestroLegacyPiDir(),
    appUserDataPath: app.getPath('userData'),
    homeDirectory: homedir()
  });
  const failures: string[] = [];

  try {
    const rewritten = stripCrmsProviderFromPiModels(paths);
    if (rewritten.length > 0) console.log(`[maestro] dropped the ai-crms pi provider from ${rewritten.length} file(s)`);
  } catch (error) {
    failures.push(`pi models: ${describe(error)}`);
  }

  try {
    const removed = removeCrmsCliCredentials(paths.cliCredentialDirs);
    if (removed.length > 0) console.log(`[maestro] removed ${removed.length} Micromeet CLI credential file(s)`);
  } catch (error) {
    failures.push(`cli credentials: ${describe(error)}`);
  }

  try {
    const dropped = await removeCrmsTabs();
    if (dropped > 0) console.log(`[maestro] dropped ${dropped} saved ${CRMS_TAB_HOST} tab(s)`);
  } catch (error) {
    failures.push(`saved tabs: ${describe(error)}`);
  }

  try {
    const dropped = await removeOrphanConfigDomains();
    if (dropped > 0) console.log(`[maestro] dropped ${dropped} orphan integration config row(s)`);
  } catch (error) {
    failures.push(`integration config rows: ${describe(error)}`);
  }

  if (failures.length > 0) {
    // 不写 marker:下次启动整段重来,比留一枚清不掉的 JWT 好。每一步都是幂等的。
    console.warn(`[maestro] CRMS residue cleanup incomplete, retrying next launch — ${failures.join('; ')}`);
    return;
  }
  await configStore.upsert({
    domain: RETIREMENT_CONFIG_DOMAIN,
    key: CRMS_RESIDUE_CLEANUP_KEY,
    options: { at: Date.now() }
  });
};

let cleanupPromise: Promise<void> | null = null;

/**
 * 清一次 AI-CRMS 退役后盘上仍然留着的凭据与孤儿行。
 *
 * 调用时机受两头夹:必须在 sqlite 就绪**之后**(ConfigDao / TabsDao 都住在那个隐藏窗口的
 * preload 里),又必须在主窗口创建**之前**(历史 tab 是主窗口起来后由 home renderer 恢复的,
 * 见 `MenuBar/tab.store.ts`)。`maestroWindow.handler.ts` 的 `boot()` 正好是这段窗口。
 *
 * marker 命中之后每次启动只多一次 config 读,不去 stat 那几个文件。
 * 永不抛:清理失败降级成一次 warn,不能让 Maestro 起不来。
 */
export const runCrmsResidueCleanupOnce = async (): Promise<void> => {
  cleanupPromise ??= cleanup().catch((error: unknown) => {
    console.warn('[maestro] CRMS residue cleanup skipped:', error);
  });
  await cleanupPromise;
};
