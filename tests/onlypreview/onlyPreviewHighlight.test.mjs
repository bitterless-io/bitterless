import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// 代码高亮的两处**坏了不会报错**的接缝(docs/features/code-highlighting-shiki.md)。
//
// 上色链条是:分类器按扩展名给出一个语言 id → 高亮器按那个 id 动态 import 一份 TextMate 语法。
// 两端各自都合法、但对不上时,结果是**那个语言静默没有颜色** —— 没有异常、没有日志、
// 任何测试都不会红。这正是需要断言的形状。
//
// 用源码文本核对而不是真 import:高亮器是 TS + 动态 `import('@shikijs/langs/*')`,在 node --test
// 里跑要一整套加载器,而这两条不变量是**表与表之间的对应关系**,读表就够,不需要真的分词。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const CLASSIFIER = 'src/main/miniapps/onlypreview/onlyPreviewClassifier.service.ts';
const HIGHLIGHTER = 'src/renderer/onlypreview/common/onlyPreviewHighlighter.service.ts';
const MONACO_GLUE = 'src/renderer/onlypreview/preview/src/onlyPreviewMonacoHighlight.service.ts';
const MONACO_VIEW =
  'src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue';

/** `LANGUAGE_BY_EXTENSION` 的全部取值。 */
const classifierLanguages = () => {
  const src = source(CLASSIFIER);
  const table = src.slice(
    src.indexOf('const LANGUAGE_BY_EXTENSION'),
    src.indexOf('const basenameOf')
  );
  assert.ok(table.length > 200, 'LANGUAGE_BY_EXTENSION 没切出来 —— 断言会变成空集通过');
  return [...table.matchAll(/'\.[^']+':\s*'([^']*)'/g)].map((m) => m[1]);
};

/** 高亮器里有加载器的语言 id ＋ 别名表。 */
const highlighterTables = () => {
  const src = source(HIGHLIGHTER);
  const loaders = src.slice(
    src.indexOf('const LANGUAGE_LOADERS'),
    src.indexOf('const LANGUAGE_ALIASES')
  );
  const aliases = src.slice(
    src.indexOf('const LANGUAGE_ALIASES'),
    src.indexOf('export const normalizeHighlightLanguage')
  );
  assert.ok(loaders.length > 200, 'LANGUAGE_LOADERS 没切出来');
  assert.ok(aliases.length > 100, 'LANGUAGE_ALIASES 没切出来');
  return {
    loaders: new Set(
      [...loaders.matchAll(/^\s{2}'?([a-z0-9-]+)'?:\s*\(\)\s*=>/gm)].map((m) => m[1])
    ),
    aliases: Object.fromEntries(
      [...aliases.matchAll(/^\s{2}'?([a-z0-9-]+)'?:\s*'([^']*)'/gm)].map((m) => [m[1], m[2]])
    )
  };
};

test('every language the classifier can emit has a shiki grammar loader', () => {
  const emitted = classifierLanguages();
  const { loaders, aliases } = highlighterTables();
  assert.ok(emitted.length >= 30, `分类器取值只解析出 ${emitted.length} 个 —— 正则大概坏了`);
  assert.ok(loaders.size >= 25, `加载器只解析出 ${loaders.size} 个 —— 正则大概坏了`);

  const missing = [];
  for (const language of new Set(emitted)) {
    if (!language) continue;
    const resolved = language in aliases ? aliases[language] : language;
    // 别名映射到空串 = 刻意的「不上色」(plaintext),不是缺口。
    if (resolved === '') continue;
    if (!loaders.has(resolved)) missing.push(`${language}${resolved === language ? '' : ` → ${resolved}`}`);
  }
  assert.deepEqual(
    missing,
    [],
    '这些语言分类器会给出、但高亮器没有语法加载器 —— 它们会静默失去颜色:\n  ' + missing.join('\n  ')
  );
});

test('the four lossy extension mappings stay corrected', () => {
  const src = source(CLASSIFIER);
  // 这四条曾把一整层语法的颜色丢掉。回退不会让任何别的测试变红,所以逐条钉住。
  for (const [extension, language] of [
    ['.tsx', 'tsx'],
    ['.jsx', 'jsx'],
    ['.vue', 'vue'],
    ['.toml', 'toml']
  ]) {
    assert.match(
      src,
      new RegExp(`'\\${extension}':\\s*'${language}'`),
      `${extension} 必须映射到 '${language}' —— 归到近似语言等于那一层语法整段无色`
    );
  }
});

test('the highlighter loads grammars one at a time, not the whole bundle', () => {
  const src = source(HIGHLIGHTER);
  // `shiki` 的 bundled 入口会把 694 个语法(9.9 MB)全部静态拉进产物。
  assert.doesNotMatch(
    src,
    /from 'shiki'/,
    "不能 import 'shiki' 的 bundled 入口 —— 那会把全部语法静态打进产物"
  );
  assert.match(src, /from 'shiki\/core'/);
  assert.match(src, /createHighlighterCore/);
  // 模板字符串 `import()` 在 Vite 里会转成 glob,同样把 694 个语法各自产出一个 chunk。
  assert.doesNotMatch(
    src,
    /import\(`@shikijs\/langs\//,
    '模板字符串 import 会被 Vite 转成 glob,等于全量打包 —— 必须是静态映射表'
  );
  assert.match(src, /import\('@shikijs\/langs\/typescript'\)/);
});

test('the JS regex engine is used, so no oniguruma WASM ships', () => {
  const src = source(HIGHLIGHTER);
  assert.match(src, /createJavaScriptRegexEngine/);
  assert.doesNotMatch(
    src,
    /engine\/oniguruma|shiki\/wasm/,
    '实测 30 种语言两引擎逐 token 一致,所以不带 WASM;要改回来得先重测'
  );
});

test('the GitHub theme is what gets loaded', () => {
  const src = source(HIGHLIGHTER);
  assert.match(src, /github-light/);
  assert.match(src, /ONLY_PREVIEW_HIGHLIGHT_THEME = 'github-light'/);
});

test('Monaco stays on the API-only entry, degrades to plain text, and cannot render the wrong file', () => {
  const glue = source(MONACO_GLUE);
  const view = source(MONACO_VIEW);

  // 语法加载有界:一次慢加载不该把预览卡住。
  assert.match(glue, /Promise\.race/);
  assert.match(glue, /GRAMMAR_TIMEOUT_MS/);
  // `tsx` / `vue` / `toml` 不是 Monaco 内置 id,不先注册 Monaco 会拒绝用它建 model。
  assert.match(glue, /monaco\.languages\.register/);

  // 组件侧:`createEditor` 变异步之后必须有代次围栏。没有它,await 期间切文件会让
  // 后到的那次先建好、再被先发的那次覆盖 —— 打开 B 却显示 A。
  assert.match(view, /let createGeneration = 0/);
  assert.match(view, /const generation = \+\+createGeneration/);
  assert.ok(
    view.indexOf('await prepareMonacoHighlighting') <
      view.indexOf('if (generation !== createGeneration) return'),
    '代次比较必须在 await 之后 —— 在之前比等于没比'
  );
  assert.ok(
    view.indexOf('if (generation !== createGeneration) return') <
      view.indexOf('monaco.editor.createModel'),
    '代次比较必须在建 model 之前'
  );
  // 主题与语法就绪状态由服务统一返回,组件不得恢复旧的未加载主题或原语言分词器。
  assert.doesNotMatch(view + glue, /MONACO_PLAIN_FALLBACK_THEME|theme: 'vs'/);
  assert.match(view, /highlighting\.language/);
  assert.doesNotMatch(view, /highlighting\??\.language\s*\?\?/);

  // **不许回到 barrel 入口。** `monaco-editor` 的 barrel 会导入 css/html/json/typescript
  // 四个语言贡献,它们**按需去取语言 worker**,而那四个 worker 已经不打包了
  // (`electron.vite.config.ts` 的 `languageWorkers: ['editorWorkerService']`)。
  // 回到 barrel 不会有编译错误 —— 只会在打开一个 .ts 文件时去取一个不存在的 worker。
  assert.match(
    view,
    /from 'monaco-editor\/esm\/vs\/editor\/editor\.api'/,
    'Monaco 必须走 API-only 入口,否则语言贡献会去取已被砍掉的 worker'
  );
  assert.doesNotMatch(
    view,
    /from 'monaco-editor'/,
    "barrel 入口会带回 css/html/json/typescript 四个语言贡献"
  );
});
