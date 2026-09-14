// 把 shiki 的 TextMate 分词器装进 Monaco —— 换掉 monarch 上色,Monaco 本身留着。
//
// Monaco 留着是因为 OnlyPreview 依赖它的三件事换不掉:find adapter
// (`onlyPreviewMonacoFind.service.ts`)、选区字符计数、以及大文件的虚拟滚动。所以这里只换
// **上色那一层**,不换编辑器。诊断与实测见 `docs/features/code-highlighting-shiki.md`。
import type * as monacoNs from 'monaco-editor';
import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco';
import {
  ONLY_PREVIEW_HIGHLIGHT_THEME,
  normalizeHighlightLanguage,
  prepareHighlighter,
  prepareHighlightTheme
} from '../../common/onlyPreviewHighlighter.service';

// 主题与语法共享等待上限。超时显示纯文本;后台加载仍会缓存供下次打开使用。
const GRAMMAR_TIMEOUT_MS = 1200;

/**
 * 已经把哪些语言的分词器装进 Monaco 了。
 *
 * `shikiToMonaco` 一次性为**当前已加载的全部语法**装分词器,所以每加载一个新语法都要重调一次。
 * 这个集合只是用来跳过重复调用 —— 重调不会出错,但会重复注册主题数据。
 */
const installed = new Set<string>();
const registeredThemes = new Set<string>();

const waitForHighlighting = async <T>(pending: Promise<T>, timeoutMs: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const registerLanguageId = (monaco: typeof monacoNs, id: string): void => {
  // `tsx` / `jsx` / `vue` / `toml` **不是** Monaco 的内置语言 id,不先注册的话 Monaco 会拒绝
  // 用它建 model(退回 plaintext)。`typescript` 这些内置的重复注册是无害的,所以统一先查再注册。
  if (monaco.languages.getLanguages().some((language) => language.id === id)) return;
  monaco.languages.register({ id });
};

/**
 * 备好一个语言在 Monaco 里的 shiki 高亮。返回要传给 `monaco.editor.create` 的
 * `{ language, theme }`。语法未就绪时必须用真正的 plaintext,避免调用已注册的分词器。
 * GitHub 主题独立于语法加载;主题本身失败/超时时省略 theme,保留当前可读配色。
 * `@shikijs/monaco` 会把 editor.create/setTheme 的主题名转交给 Shiki,不能传未加载的主题。
 */
export const prepareMonacoHighlighting = async (
  monaco: typeof monacoNs,
  language: string | null | undefined,
  timeoutMs: number = GRAMMAR_TIMEOUT_MS
): Promise<{ language: string; theme?: string }> => {
  const plain: { language: string; theme?: string } = { language: 'plaintext' };
  const deadline = Date.now() + timeoutMs;
  try {
    const themeReady = await waitForHighlighting(prepareHighlightTheme(), timeoutMs);
    if (!themeReady) return plain;
    if (!registeredThemes.has(themeReady.theme)) {
      // 适配器返回 monaco-editor-core 的主题类型;这里用的是兼容的 monaco-editor API。
      monaco.editor.defineTheme(
        themeReady.theme,
        textmateThemeToMonacoTheme(
          themeReady.core.getTheme(themeReady.theme)
        ) as unknown as monacoNs.editor.IStandaloneThemeData
      );
      registeredThemes.add(themeReady.theme);
    }
    plain.theme = themeReady.theme;

    const normalized = normalizeHighlightLanguage(language);
    if (!normalized) return plain;
    const ready = await waitForHighlighting(
      prepareHighlighter(normalized, ONLY_PREVIEW_HIGHLIGHT_THEME),
      Math.max(0, deadline - Date.now())
    );
    if (!ready) return plain;

    registerLanguageId(monaco, normalized);
    const signature = `${ready.language}::${ready.theme}`;
    if (!installed.has(signature)) {
      // `shikiToMonaco` 的类型标的是 `monaco-editor-core`,而这里传的是 `monaco-editor` ——
      // 后者是前者的超集,运行时完全兼容;这个 cast 是为了那个类型标注,不是为了绕过检查。
      shikiToMonaco(ready.core, monaco as unknown as Parameters<typeof shikiToMonaco>[1], {
        // 与组件里 `maxTokenizationLineLength` / `stopRenderingLineAfter` 的 20_000 对齐:
        // 三个上限不一致的话,一行超长的最小化产物会在不同层各截断一次,表现成"部分有色"。
        tokenizeMaxLineLength: 20_000,
        tokenizeTimeLimit: 500
      });
      installed.add(signature);
    }
    return { language: ready.language, theme: ready.theme };
  } catch {
    return plain;
  }
};
