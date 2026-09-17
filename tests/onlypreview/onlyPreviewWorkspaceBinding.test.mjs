import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { source } from './onlyPreviewCoreTest.helper.mjs';

/**
 * 会话的工作区和 OnlyPreview 的**绑定关系**:选中就打开、替换就换目录、停用就解绑并保留宿主
 * (Ral 2026-09-14)。以及「已经挂着的那一个赢过上次那一种」。
 *
 * 这一组是**源码守卫**,理由说清楚:这条链的每一环都要 Electron(BrowserWindow / View / composite
 * tab 的激活),本仓禁止在验证里起 Electron。所以这里钉的是**接线**——那恰好是这次真实发生过的
 * 失败模式:环都在,顺序或分支挂错一个,表现是「点了没反应」而没有任何报错。
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('挂在 tab 上时,点芯片要激活那个 tab', () => {
  const opener = stripComments(source('src/main/windows/onlyPreviewMaestroOpener.ts'));

  test('先问挂载是 tab 还是窗口,而不是只问「有没有 host」', () => {
    // `getStandaloneHost()` 在 tab 挂载时同样为真(`openOnMount` 也设 `standaloneHost`),
    // 所以只问它就会把 tab 那一种也送进窗口那条路。
    assert.match(
      opener,
      /const mountedHost = onlyPreviewWindowHelper\.getStandaloneHost\(\);/,
      '拿到 host 之后要留着它去问挂载种类'
    );
    assert.match(opener, /if \(isMountedOnCoworkTab\(mountedHost\.hostToken\)\)/);
  });

  test('tab 那一支走 maestro 自己的 tab 路径 —— 那一侧才知道 tab id', () => {
    // 切片必须从 `if (mountedHost)` 这个**块的开头**取,而不是从 tab 分支自己取:
    // 从后者取的话,把 tab 分支整块挪到窗口分支之后(它就变成死代码)这个变异会**存活** ——
    // 因为切片后面还有 `mount === 'window'` 那一支的同名调用可以充当"更晚出现"。
    const block = opener.slice(
      opener.indexOf('if (mountedHost) {'),
      opener.indexOf('const mount = peekOnlyPreviewHostMount()')
    );
    assert.ok(block.length > 0, '找不到 `if (mountedHost)` 那个块');
    const viaMaestro = block.indexOf('maestroWindowHelper.openWorkspaceInPreview');
    const viaExplicit = block.indexOf('openRegisteredOnlyPreviewExplicitTarget');
    assert.ok(viaMaestro > -1, 'tab 那一支必须走 openWorkspaceInPreview（它里面会 activateTab）');
    assert.ok(viaExplicit > -1, '窗口那一支不该消失');
    assert.ok(
      viaMaestro < viaExplicit,
      'tab 分支要排在窗口分支之前 —— 排在后面它就是一段永远到不了的死代码'
    );
  });

  test('挂载查询把「已经不活着」当成不是 tab,而不是让它抛出去', () => {
    // `getMountKind` 在挂载死掉时抛。芯片不该因为一次竞态报错。
    assert.match(
      opener,
      /const isMountedOnCoworkTab = \(hostToken: string\): boolean => \{\s*try \{\s*return onlyPreviewWindowHelper\.getMountKind\(hostToken\) === 'cowork';\s*\} catch \{\s*return false;\s*\}/
    );
  });
});

describe('停用工作区 → 解绑匹配的 Project 并保留 OnlyPreview', () => {
  const opener = stripComments(source('src/main/windows/onlyPreviewMaestroOpener.ts'));

  test('接入保留宿主的清理服务,不销毁窗口或 tab', () => {
    const close = opener.slice(opener.indexOf('closeForPath:'));
    assert.match(close, /await clearOnlyPreviewWorkspace\(host\.hostToken, rootRealPath\)/);
    assert.doesNotMatch(close, /destroyStandalone/);
    const clear = stripComments(source('src/main/miniapps/onlypreview/onlyPreviewClearWorkspace.service.ts'));
    assert.match(clear, /onlyPreviewTargetMutations\.run/);
    assert.ok(clear.indexOf('canClearProjectRoot') < clear.indexOf('clearWorkspace(hostToken)'));
    assert.doesNotMatch(clear, /destroyStandalone|ensureStandalone/);
  });

  test('两边都过 realpath —— 软链拼法要能比上', () => {
    const close = opener.slice(opener.indexOf('closeForPath:'));
    assert.match(close, /await realpath\(absolutePath\)\.catch\(\(\) => absolutePath\)/);
  });

  test('没有承载时直接返回,不抛', () => {
    const close = opener.slice(opener.indexOf('closeForPath:'));
    assert.match(close, /if \(!host\) return;/);
  });
});

describe('渲染进程那一侧的接线', () => {
  const store = stripComments(
    source('src/renderer/maestro/control/src/store/message.store.ts')
  );

  test('选择结果交还面板，自动打开由 Main picker 负责', () => {
    const choose = store.slice(
      store.indexOf('async chooseWorkspace('),
      store.indexOf('async stopUsingWorkspace(')
    );
    assert.doesNotMatch(choose, /openWorkspaceInPreview/);
    assert.match(choose, /return result/);
    assert.doesNotMatch(choose, /await this\.persistSession/);
  });

  test('停用时用的是**解绑前**的那个路径', () => {
    const stop = store.slice(store.indexOf('async stopUsingWorkspace('));
    const captured = stop.indexOf('const previousPath = session.detail.workspace?.path');
    const cleared = stop.indexOf("path: ''");
    assert.ok(captured > -1, '不先取下来,解绑之后就没有路径可比对了');
    assert.ok(captured < cleared, '取路径必须排在解绑之前');
    assert.match(stop, /if \(previousPath\) await coach\.closeWorkspacePreview\(\{ path: previousPath \}\)/);
  });

  test('这条挂在人的动作上,而不是 setWorkspaceDirectory 那个状态同步上', () => {
    // `refreshWorkspace()` 每次载入/切会话都会调 `setWorkspaceDirectory`。
    // 接在那儿会变成「一开 app 就自己弹出预览」。
    const refresh = store.slice(store.indexOf('async refreshWorkspace('));
    assert.ok(
      !refresh.slice(0, 900).includes('openWorkspaceInPreview'),
      'refreshWorkspace 里不许开预览'
    );
  });
});

describe('文案:不再说 clear', () => {
  const KEYS = [
    'switchWorkspace',
    'openWorkspaceInPreview',
    'workspacePreviewFailed',
    'stopUsingWorkspaceTooltip',
    'stopUsingWorkspaceTitle',
    'stopUsingWorkspaceContent',
    'stopUsingWorkspace',
    'keepWorkspace'
  ];

  for (const language of ['en', 'zh']) {
    test(`${language} 有全部新键,且没有 clearWorkspace 残留`, () => {
      const text = source(`src/renderer/common/i18n/${language}.ts`);
      for (const key of KEYS) assert.match(text, new RegExp(`\\b${key}:`), `${language} 缺 ${key}`);
      assert.ok(!/clearWorkspace/.test(text), `${language} 还留着 clearWorkspace`);
    });
  }

  test('面板里没有硬编码的英文工作区文案 —— 一律走 i18nHelper', () => {
    const panel = stripComments(source('src/renderer/maestro/control/src/ChatPanel.vue'));
    for (const hardcoded of [
      'content="Switch workspace"',
      'content="Clear workspace"',
      'aria-label="Switch workspace"',
      'aria-label="Clear workspace"',
      'aria-label="Open workspace in OnlyPreview"'
    ]) {
      assert.ok(!panel.includes(hardcoded), `还有硬编码: ${hardcoded}`);
    }
    assert.match(panel, /i18nHelper\.maestroControl\.chat\.switchWorkspace/);
    assert.match(panel, /i18nHelper\.maestroControl\.chat\.stopUsingWorkspaceTooltip/);
    // 预览应用的名字只有一个来源
    assert.match(panel, /MAESTRO_ONLY_PREVIEW_APP_NAME/);
  });
});
