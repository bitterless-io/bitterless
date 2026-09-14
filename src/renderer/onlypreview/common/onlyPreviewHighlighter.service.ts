// 代码高亮 —— shiki 的真 TextMate 语法 ＋ GitHub 主题,语法按需加载。
//
// 为什么不是 Monaco 自带的:Monaco 在浏览器里上色用 **monarch**(正则分词器),不是 VS Code
// 真正用的 TextMate 语法。monarch 的 TS/JS 语法标关键字、字符串、注释、数字,但**不区分
// 类型、函数、属性、JSX、装饰器** —— 而那正是 TS/JS 里承载最多信息量的地方。叠上 Monaco 里
// token 颜色最少的 `vs` 主题,就是 Ral 2026-09-08 说的「ts,js 高亮效果都很差」。
// 完整诊断与实测数据见 `docs/features/code-highlighting-shiki.md`。
//
// 三个消费者共用这一份:Monaco 文本预览(经 `@shikijs/monaco`)、markdown 预览的代码块、
// 以及 micromeet-cowork 的聊天 markdown。
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/**
 * 主题名。
 *
 * 目前只有亮色,因为 OnlyPreview 的设置契约把主题写成了字面量 `theme: 'light'`
 * (`onlyPreview.types.ts`)—— 那是一个显式约束,不是漏做。等那个契约放宽,这里加一个
 * `github-dark` 的 thunk、把这个常量换成函数即可,其余代码不用动。
 */
export const ONLY_PREVIEW_HIGHLIGHT_THEME = 'github-light';

const THEME_LOADERS: Record<string, () => Promise<unknown>> = {
  'github-light': () => import('@shikijs/themes/github-light')
};

/**
 * 语法的按需加载表 —— **静态映射,不是模板字符串 `import()`**。
 *
 * 这一条是承重的。`import(\`@shikijs/langs/${id}\`)` 在 Vite 里会被转成 glob 导入,于是
 * `@shikijs/langs` 下**全部 694 个语法**都会各自产出一个 chunk —— 即使一个都不会被加载,
 * 9.9 MB 也已经进了打包产物。对一个桌面应用来说那就是 9.9 MB 白装。
 *
 * 静态表把 chunk 集合限制在我们真的会用的这些上,而且**未知 id 变成一次 `null` 返回**
 * (调用方退回无高亮)而不是运行时 404。
 *
 * 键是**归一之后**的 shiki 语言 id;从分类器那套 id 的映射在 `normalizeHighlightLanguage`。
 */
const LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  json5: () => import('@shikijs/langs/json5'),
  jsx: () => import('@shikijs/langs/jsx'),
  less: () => import('@shikijs/langs/less'),
  lua: () => import('@shikijs/langs/lua'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  shell: () => import('@shikijs/langs/shell'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml')
};

/**
 * 分类器给出的语言 id → shiki 语言 id。
 *
 * 大部分是恒等的,但有**四个是分类器在丢信息**,这里一并纠正 —— 不纠正的话 JSX、Vue SFC、
 * TOML 的高亮仍然是残的,而那就等于这次改动没做完:
 *
 *   · `.tsx` 现在归 `typescript` → 归 `tsx`(否则 JSX 语法整段没有颜色)
 *   · `.jsx` 现在归 `javascript` → 归 `jsx`(同上)
 *   · `.vue` 现在归 `html` → 归 `vue`(否则 `<script setup>` 里的 TS 当纯文本)
 *   · `.toml` 现在归 `ini` → 归 `toml`(ini 语法认不出 TOML 的表头与数组)
 *
 * 这四条的**修改点在分类器**(`LANGUAGE_BY_EXTENSION`),不在这里 —— 这张表只负责把已经
 * 到手的 id 映射过去,并对旧值保持兼容,这样两侧改动的顺序不重要。
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  plaintext: '',
  text: '',
  txt: '',
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
  'objective-c': 'c'
};

/**
 * 归一到一个**确实有加载器**的 shiki 语言 id,否则 `null`。
 *
 * 返回 `null` 是一个正常结果,不是错误:纯文本、未知扩展名、以及我们没打包语法的语言都走这条,
 * 调用方据此退回「不高亮」。让它抛错会把一次配色降级变成一次预览失败。
 */
export const normalizeHighlightLanguage = (language: string | null | undefined): string | null => {
  const raw = String(language ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  const aliased = LANGUAGE_ALIASES[raw] ?? raw;
  if (!aliased) return null;
  return aliased in LANGUAGE_LOADERS ? aliased : null;
};

/** 已打包语法的全部 id —— 守卫用它对着分类器的表核对覆盖。 */
export const highlightLanguageIds = (): string[] => Object.keys(LANGUAGE_LOADERS).sort();

let highlighterPromise: Promise<HighlighterCore> | null = null;
// 每个 id 一个 in-flight promise:两处同时要 `typescript` 只加载一次语法。
const loadedLanguages = new Map<string, Promise<void>>();
const loadedThemes = new Map<string, Promise<void>>();

const highlighter = async (): Promise<HighlighterCore> => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [],
      langs: [],
      // 纯 JS 引擎,不带 oniguruma WASM。实测分类器会用到的 30 种语言与 oniguruma 输出
      // **逐 token 一致**(含 TSX 与真 C++),所以省掉的 WASM 不是用保真度换的。
      // `forgiving` 保持默认(false):哪天加了 JS 引擎不支持的语法会**抛错**而不是静默降级,
      // 所以这条决定是可发现的。
      engine: createJavaScriptRegexEngine()
    }).catch((error) => {
      // 失败要能重试:把 promise 清掉,否则一次瞬时失败会把高亮永久关掉。
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
};

const ensureTheme = async (core: HighlighterCore, theme: string): Promise<void> => {
  const existing = loadedThemes.get(theme);
  if (existing) return existing;
  const loader = THEME_LOADERS[theme];
  if (!loader) throw new Error(`No shiki theme loader for ${theme}`);
  const pending = loader()
    .then(async (mod) => {
      await core.loadTheme((mod as { default: never }).default);
    })
    .catch((error) => {
      loadedThemes.delete(theme);
      throw error;
    });
  loadedThemes.set(theme, pending);
  return pending;
};

const ensureLanguage = async (core: HighlighterCore, language: string): Promise<void> => {
  const existing = loadedLanguages.get(language);
  if (existing) return existing;
  const loader = LANGUAGE_LOADERS[language];
  if (!loader) throw new Error(`No shiki language loader for ${language}`);
  const pending = loader()
    .then(async (mod) => {
      await core.loadLanguage((mod as { default: never }).default);
    })
    .catch((error) => {
      loadedLanguages.delete(language);
      throw error;
    });
  loadedLanguages.set(language, pending);
  return pending;
};

/** Monaco 的纯文本路径也需要已加载的主题,但不应因此加载任何语法。 */
export const prepareHighlightTheme = async (
  theme: string = ONLY_PREVIEW_HIGHLIGHT_THEME
): Promise<{ core: HighlighterCore; theme: string } | null> => {
  try {
    const core = await highlighter();
    await ensureTheme(core, theme);
    return { core, theme };
  } catch {
    return null;
  }
};

/**
 * 备好一个语言的高亮器。返回归一后的 id,拿不到就 `null`。
 *
 * 调用方拿到 `null` 时应当**照旧渲染,只是不上色** —— 高亮是配色,不是内容。
 */
export const prepareHighlighter = async (
  language: string | null | undefined,
  theme: string = ONLY_PREVIEW_HIGHLIGHT_THEME
): Promise<{ core: HighlighterCore; language: string; theme: string } | null> => {
  const normalized = normalizeHighlightLanguage(language);
  if (!normalized) return null;
  try {
    const core = await highlighter();
    await Promise.all([ensureTheme(core, theme), ensureLanguage(core, normalized)]);
    return { core, language: normalized, theme };
  } catch {
    return null;
  }
};

/**
 * 把一段代码渲染成带高亮的 HTML —— markdown 代码块用这条。
 *
 * `null` = 没有可用语法,调用方自己转义并输出纯 `<pre><code>`。**这里不做转义兜底**:
 * 返回一段"未转义的原文"会把一个配色问题变成一个注入问题,所以宁可返回 `null` 让调用方
 * 走它自己那条已经在转义的路径。
 */
export const highlightCodeToHtml = async (
  code: string,
  language: string | null | undefined,
  theme: string = ONLY_PREVIEW_HIGHLIGHT_THEME
): Promise<string | null> => {
  const ready = await prepareHighlighter(language, theme);
  if (!ready) return null;
  try {
    return ready.core.codeToHtml(code, { lang: ready.language, theme: ready.theme });
  } catch {
    return null;
  }
};
