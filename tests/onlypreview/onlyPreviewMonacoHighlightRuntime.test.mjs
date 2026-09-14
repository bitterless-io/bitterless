import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'package.json'));
const themeId = 'github-light';
const themeImport = '@shikijs/themes/github-light';
let runtimeSequence = 0;

// Keep the real Shiki engine, theme, grammars and @shikijs/monaco adapter. Only import timing/failure
// is controlled, so editor.create exercises the adapter's actual global theme wrapper.
const loadRuntime = async (t, beforeImport = async () => {}) => {
  const cache = join(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, 'onlypreview-highlight-test-'));
  const hookKey = `__onlypreviewHighlightImport${++runtimeSequence}`;
  const imports = new Map();
  globalThis[hookKey] = {
    async load(id) {
      imports.set(id, (imports.get(id) ?? 0) + 1);
      await beforeImport(id, imports.get(id));
      return import(pathToFileURL(require.resolve(id)).href);
    }
  };
  t.after(() => {
    delete globalThis[hookKey];
    rmSync(directory, { recursive: true, force: true });
  });
  const common = join(root, 'src/renderer/onlypreview/common/onlyPreviewHighlighter.service.ts');
  const glue = join(root, 'src/renderer/onlypreview/preview/src/onlyPreviewMonacoHighlight.service.ts');
  const outfile = join(directory, 'runtime.mjs');
  await build({
    stdin: { contents: `export * from ${JSON.stringify(common)}; export * from ${JSON.stringify(glue)};`, resolveDir: root },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [{
      name: 'controlled-lazy-imports',
      setup(builder) {
        builder.onLoad({ filter: /onlyPreviewHighlighter\.service\.ts$/ }, ({ path }) => ({
          contents: readFileSync(path, 'utf8').replace(
            /\(\) => import\('(@shikijs\/(?:langs|themes)\/[^']+)'\)/g,
            (_, id) => `() => globalThis[${JSON.stringify(hookKey)}].load(${JSON.stringify(id)})`
          ),
          loader: 'ts',
          resolveDir: dirname(path)
        }));
      }
    }]
  });
  return { runtime: await import(pathToFileURL(outfile).href), imports };
};

const createMonaco = () => {
  const languageIds = new Set(['plaintext']);
  const providers = new Map();
  const themes = new Map();
  const definedThemes = [];
  const selectedThemes = [];
  let currentTheme;
  const monaco = {
    languages: {
      getLanguages: () => [...languageIds].map((id) => ({ id })),
      register: ({ id }) => languageIds.add(id),
      setTokensProvider: (id, provider) => {
        providers.set(id, provider);
        return { dispose() {} };
      }
    },
    editor: {
      defineTheme(id, theme) {
        definedThemes.push(id);
        themes.set(id, theme);
      },
      setTheme(id) {
        assert.ok(themes.has(id), `Monaco theme ${id} must be defined before use`);
        selectedThemes.push(id);
        currentTheme = id;
      },
      createModel(value, language) {
        assert.ok(languageIds.has(language), `model language ${language} must be registered`);
        return { value, language };
      },
      create(_host, options) {
        if (options.theme) monaco.editor.setTheme(options.theme);
        const provider = providers.get(options.model.language);
        const tokens = provider?.tokenize(options.model.value, provider.getInitialState()).tokens;
        return { ...options.model, theme: currentTheme, tokens };
      }
    }
  };
  return { monaco, providers, definedThemes, selectedThemes };
};

const open = (monaco, highlighting, value = 'const answer: number = 42') => {
  const model = monaco.editor.createModel(value, highlighting.language);
  return monaco.editor.create({}, { model, ...(highlighting.theme ? { theme: highlighting.theme } : {}) });
};

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('cold Markdown loads GitHub plus only the requested grammar and creates a readable editor', async (t) => {
  const { runtime, imports } = await loadRuntime(t);
  assert.equal(imports.size, 0, 'importing the service must not eagerly load themes or grammars');
  const { monaco, selectedThemes } = createMonaco();
  const ready = await runtime.prepareMonacoHighlighting(monaco, 'md');
  assert.deepEqual(ready, { language: 'markdown', theme: themeId });
  const editor = open(monaco, ready, '# Heading');
  assert.equal(editor.value, '# Heading');
  assert.equal(editor.theme, themeId);
  assert.ok(editor.tokens.length > 0, 'real Markdown tokenizer must run');
  assert.deepEqual([...imports.keys()].sort(), ['@shikijs/langs/markdown', themeImport]);
  assert.ok(selectedThemes.every((theme) => theme === themeId));
});

test('highlighted → plaintext/unknown → highlighted keeps GitHub and reuses theme/grammar caches', async (t) => {
  const { runtime, imports } = await loadRuntime(t);
  const { monaco, definedThemes, selectedThemes } = createMonaco();
  const [first, concurrent] = await Promise.all([
    runtime.prepareMonacoHighlighting(monaco, 'ts'),
    runtime.prepareMonacoHighlighting(monaco, 'typescript')
  ]);
  assert.deepEqual(concurrent, first);
  assert.ok(open(monaco, first).tokens.some((token) => token.scopes), 'real TypeScript colors must exist');
  const definitions = definedThemes.length;
  for (const language of ['plaintext', 'brainfuck', '', undefined]) {
    const ready = await runtime.prepareMonacoHighlighting(monaco, language);
    assert.deepEqual(ready, { language: 'plaintext', theme: themeId });
    const editor = open(monaco, ready, 'plain <content>');
    assert.equal(editor.value, 'plain <content>');
    assert.equal(editor.tokens, undefined);
    assert.equal(editor.theme, themeId);
  }
  assert.ok(open(monaco, await runtime.prepareMonacoHighlighting(monaco, 'ts')).tokens.length > 0);
  assert.equal(definedThemes.length, definitions, 'cache hits must not redefine themes/reinstall adapter');
  assert.deepEqual([...imports], [[themeImport, 1], ['@shikijs/langs/typescript', 1]]);
  assert.ok(selectedThemes.every((theme) => theme === themeId));
});

test('cold plaintext defines GitHub without loading or registering any grammar', async (t) => {
  const { runtime, imports } = await loadRuntime(t);
  const { monaco, providers, definedThemes } = createMonaco();
  const ready = await runtime.prepareMonacoHighlighting(monaco, 'text');
  assert.deepEqual(ready, { language: 'plaintext', theme: themeId });
  assert.equal(open(monaco, ready).theme, themeId);
  assert.equal(providers.size, 0);
  assert.deepEqual(definedThemes, [themeId]);
  assert.deepEqual([...imports], [[themeImport, 1]]);
});

test('grammar timeout uses actual plaintext even with a provider installed, then retries from cache', async (t) => {
  const gate = deferred();
  const { runtime, imports } = await loadRuntime(t, (id) => id === '@shikijs/langs/javascript' ? gate.promise : undefined);
  const { monaco, providers } = createMonaco();
  await runtime.prepareMonacoHighlighting(monaco, 'ts');
  // A previously registered provider must never run while this file's grammar is unavailable.
  monaco.languages.register({ id: 'javascript' });
  providers.set('javascript', { getInitialState() { throw new Error('unloaded grammar invoked'); } });
  const slow = await runtime.prepareMonacoHighlighting(monaco, 'js', 15);
  assert.deepEqual(slow, { language: 'plaintext', theme: themeId });
  assert.equal(open(monaco, slow, 'let n = 1').value, 'let n = 1');
  gate.resolve();
  const ready = await runtime.prepareMonacoHighlighting(monaco, 'js');
  assert.equal(ready.language, 'javascript');
  assert.ok(open(monaco, ready).tokens.length > 0);
  assert.equal(imports.get('@shikijs/langs/javascript'), 1, 'timed-out import continues in the background');
});

test('failed grammar remains readable in GitHub and the next opening retries successfully', async (t) => {
  const { runtime, imports } = await loadRuntime(t, (id, attempt) => {
    if (id === '@shikijs/langs/json' && attempt === 1) throw new Error('transient grammar load failure');
  });
  const { monaco } = createMonaco();
  const failed = await runtime.prepareMonacoHighlighting(monaco, 'json');
  assert.deepEqual(failed, { language: 'plaintext', theme: themeId });
  assert.equal(open(monaco, failed, '{"ready":true}').value, '{"ready":true}');
  const ready = await runtime.prepareMonacoHighlighting(monaco, 'json');
  assert.equal(ready.language, 'json');
  assert.ok(open(monaco, ready, '{"ready":true}').tokens.length > 0);
  assert.equal(imports.get('@shikijs/langs/json'), 2);
  assert.equal(imports.get(themeImport), 1);
});

test('theme failure keeps content readable without requesting an unloaded theme and retries', async (t) => {
  const { runtime, imports } = await loadRuntime(t, (id, attempt) => {
    if (id === themeImport && attempt === 1) throw new Error('transient theme load failure');
  });
  const { monaco, providers, selectedThemes } = createMonaco();
  const failed = await runtime.prepareMonacoHighlighting(monaco, 'md');
  assert.deepEqual(failed, { language: 'plaintext' });
  assert.equal(open(monaco, failed, '# Still readable').value, '# Still readable');
  assert.equal(providers.size, 0);
  assert.deepEqual(selectedThemes, []);
  const ready = await runtime.prepareMonacoHighlighting(monaco, 'md');
  assert.equal(open(monaco, ready, '# Heading').theme, themeId);
  assert.equal(imports.get(themeImport), 2);
  assert.equal(imports.get('@shikijs/langs/markdown'), 1);
});

test('theme timeout stays bounded and completes in the background for the next file', async (t) => {
  const gate = deferred();
  const { runtime, imports } = await loadRuntime(t, (id) => id === themeImport ? gate.promise : undefined);
  const { monaco } = createMonaco();
  const slow = await runtime.prepareMonacoHighlighting(monaco, 'md', 15);
  assert.deepEqual(slow, { language: 'plaintext' });
  assert.equal(open(monaco, slow, '# Waiting').value, '# Waiting');
  assert.deepEqual([...imports], [[themeImport, 1]]);
  gate.resolve();
  const ready = await runtime.prepareMonacoHighlighting(monaco, 'md');
  assert.equal(open(monaco, ready, '# Ready').theme, themeId);
  assert.equal(imports.get(themeImport), 1);
});
