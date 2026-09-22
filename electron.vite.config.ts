import { piSkillSdkPlugin } from './scripts/maestro/piSkillSdk.plugin';
import { dirname, resolve } from 'path';
import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { config as dotenvConfig } from 'dotenv';
import { createRequire } from 'module';
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';
import theme from './theme';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import JSON5 from 'json5';
import { build as esbuild } from 'esbuild';
import { createHash } from 'crypto';
import { transformPrivilegedRendererHtml } from './src/shared/security/blankPrivilegedRendererHtml.service';

const nodeRequire = createRequire(import.meta.url);
const { loadCanonicalRigEnvironment } = nodeRequire(
  './scripts/environment/runtimeProfile.config.cjs'
) as {
  loadCanonicalRigEnvironment(projectRoot: string): {
    environment: Record<string, string>;
    profileName: string;
    releaseChannel: 'dev' | 'prod' | 'preview';
    viteEnv: 'dev' | 'prod';
    viteMode: 'debug' | 'release';
  };
};
const canonicalRigEnvironment = loadCanonicalRigEnvironment(resolve('.'));
const dotenvResult = dotenvConfig({ path: resolve('.env.rig'), override: true });
if (dotenvResult.error) throw dotenvResult.error;
if (
  process.env.VITE_MODE !== canonicalRigEnvironment.viteMode ||
  process.env.VITE_ENV !== canonicalRigEnvironment.viteEnv ||
  process.env.VITE_RELEASE_CHANNEL !== canonicalRigEnvironment.releaseChannel
) {
  throw new Error('The selected Rig profile was not applied to the Electron build process');
}

const packageMetadata = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
  version_code?: unknown;
};
if (
  typeof packageMetadata.version_code !== 'string' ||
  !/^\d{12}$/.test(packageMetadata.version_code)
) {
  throw new Error('package.json version_code must be a 12-digit string');
}

const bitterlessPreloadBuildDefine = {
  __BITTERLESS_VERSION_CODE__: JSON.stringify(packageMetadata.version_code),
  'import.meta.env.VITE_BITTERLESS_CORE_URL': JSON.stringify(process.env.VITE_BITTERLESS_CORE_URL),
  'import.meta.env.VITE_ENV': JSON.stringify(canonicalRigEnvironment.viteEnv),
  'import.meta.env.VITE_MODE': JSON.stringify(canonicalRigEnvironment.viteMode),
  'import.meta.env.VITE_RELEASE_CHANNEL': JSON.stringify(
    canonicalRigEnvironment.releaseChannel
  )
};

const bundledRuntimeDependencies = [
  '@bgotink/kdl',
  '@langchain/anthropic',
  '@langchain/core',
  '@langchain/google-genai',
  '@langchain/langgraph',
  '@langchain/openai',
  '@larksuiteoapi/node-sdk',
  '@mozilla/readability',
  'docx',
  'exceljs',
  'electron-xpc',
  'linkedom',
  'mammoth',
  'typebox',
  'unpdf'
];

const maestroSqliteDevCspPlugin = {
  name: 'bitterless:maestro-sqlite-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/maestro/sqlite/')) return html;
    return html.replace(
      /(<meta http-equiv="Content-Security-Policy" content=")default-src 'none'("\s*\/>)/,
      "$1default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* wss://localhost:*$2"
    );
  }
};

const maestroOverlayDevCspPlugin = {
  name: 'bitterless:maestro-overlay-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/maestro/tabAlias/') && !context.path.includes('/maestro/history/')) {
      return html;
    }
    return html.replace(
      /connect-src '(?:none|self)'/,
      "connect-src 'self' ws://localhost:* wss://localhost:*"
    );
  }
};

const coinDevCspPlugin = {
  name: 'bitterless:coin-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/coin/')) return html;
    return html.replace(
      "connect-src 'none'",
      "connect-src 'self' ws://localhost:* wss://localhost:*"
    );
  }
};

const translatorDevCspPlugin = {
  name: 'bitterless:translator-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/translator/')) return html;
    return html.replace(
      "connect-src 'none'",
      "connect-src 'self' ws://localhost:* wss://localhost:*"
    );
  }
};

const mottoDevCspPlugin = {
  name: 'bitterless:motto-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/motto/')) return html;
    return html.replace(
      "connect-src 'none'",
      "connect-src 'self' ws://localhost:* wss://localhost:*"
    );
  }
};

const submodulesDevCspPlugin = {
  name: 'bitterless:submodules-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/submodules/') && !context.path.includes('/zellij/')) return html;
    return html.replace(
      "connect-src 'none'",
      "connect-src 'self' ws://localhost:* wss://localhost:*"
    );
  }
};

const onlyPreviewDevCspPlugin = {
  name: 'bitterless:onlypreview-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/onlypreview/')) return html;
    return html
      .replace(
        "connect-src 'self' bitterless-preview:",
        "connect-src 'self' bitterless-preview: ws://localhost:* wss://localhost:*"
      )
      .replace("connect-src 'none'", "connect-src 'self' ws://localhost:* wss://localhost:*");
  }
};

/**
 * 独立 esbuild 调用要自己的别名表 —— 它们不吃 vite 的 `resolve.alias`。
 *
 * 一份常量而不是各写各的:`@preload/maestroSdk`(`MAESTROSDK` 的注入实现)是每个 mini-app preload
 * 都要引的,漏在哪一个 sandbox 构建里,就是那一个 mini-app 在打包版里构建失败。
 */
const maestroSdkPreloadAlias = {
  '@shared': resolve('src/shared'),
  '@preload': resolve('src/preload')
};

const onlyPreviewSandboxPreloadPlugin = {
  name: 'bitterless:onlypreview-sandbox-preload',
  async writeBundle() {
    await esbuild({
      entryPoints: {
        onlypreview: resolve('src/preload/onlypreview/onlypreview.preload.ts'),
        onlypreviewContent: resolve('src/preload/onlypreview/onlypreviewContent.preload.ts')
      },
      outdir: resolve('out/preload'),
      entryNames: '[name]',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron'],
      // 这两个 sandbox preload 走的是**独立的 esbuild 调用**,不吃 vite 的 `resolve.alias` ——
      // 少一个别名就是一条 `Could not resolve` 的构建失败,而且只在 `dev:prod` / 打包时才炸
      // (typecheck 用 tsconfig 的 paths,看不见这里)。新增共享模块时要连这里一起加。
      alias: maestroSdkPreloadAlias,
      define: bitterlessPreloadBuildDefine,
      sourcemap: false,
      logLevel: 'silent'
    });
  }
};

const trenchSandboxPreloadPlugin = {
  name: 'bitterless:trench-sandbox-preload',
  apply: 'build' as const,
  async closeBundle() {
    await esbuild({
      entryPoints: [resolve('src/preload/trench/trench.preload.ts')],
      outfile: resolve('out/preload/trench.js'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron'],
      alias: maestroSdkPreloadAlias,
      sourcemap: false,
      logLevel: 'silent'
    });
  }
};

const privilegedRuntimeBlankHtmlPlugin = {
  name: 'bitterless:privileged-runtime-blank-html',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, context: { path: string }) {
      return transformPrivilegedRendererHtml(html, context.path);
    }
  }
};

const privilegedRuntimeBlankHtmlAuditPlugin = {
  name: 'bitterless:privileged-runtime-blank-html-audit',
  apply: 'build' as const,
  closeBundle() {
    for (const rendererPath of ['trench-io', 'fileSearch']) {
      const html = readFileSync(resolve(`out/renderer/${rendererPath}/index.html`), 'utf8');
      if (!/default-src 'none'/.test(html) || !/<body>\s*<\/body>/.test(html)) {
        throw new Error(`${rendererPath} output must retain its restrictive CSP and empty body`);
      }
      if (/<(?:script|link|style|img|iframe)\b/i.test(html)) {
        throw new Error(`${rendererPath} output must not import or execute page resources`);
      }
    }
  }
};

const secureRendererHtml = (source: string, rendererName: string): string => {
  let html = source;
  const charsetMeta = html.match(/\s*<meta\s+charset=(?:"[^"]+"|'[^']+'|[^\s>]+)\s*\/?>/i);
  if (!charsetMeta) throw new Error(`${rendererName} renderer is missing its charset meta`);
  const cspMeta = html.match(
    /\s*<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i
  );
  if (!cspMeta) {
    throw new Error(`${rendererName} renderer is missing its Content-Security-Policy meta`);
  }
  let csp = cspMeta[1];
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim().length > 0);
  const hashes = [
    ...new Set(
      inlineScripts.map(
        (script) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`
      )
    )
  ];
  if (hashes.length) {
    if (!csp.includes("script-src 'self'")) {
      throw new Error(`${rendererName} renderer CSP is missing script-src 'self'`);
    }
    csp = csp.replace("script-src 'self'", `script-src 'self' ${hashes.join(' ')}`);
  }
  html = html.replace(cspMeta[0], '').replace(charsetMeta[0], '');
  return html.replace(
    /<head>/i,
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    ${charsetMeta[0].trim()}`
  );
};

const secureOnlyPreviewHtml = (source: string): string =>
  secureRendererHtml(
    source.replaceAll('./monacoeditorwork/', '../../monacoeditorwork/'),
    'OnlyPreview'
  );

const secureCoinHtml = (source: string): string =>
  secureRendererHtml(source.replaceAll('./monacoeditorwork/', '../monacoeditorwork/'), 'Trench');

const onlyPreviewHtmlSecurityPlugin = {
  name: 'bitterless:onlypreview-html-security',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, context: { path: string }) {
      if (!context.path.includes('/onlypreview/')) return html;
      return secureOnlyPreviewHtml(html);
    }
  },
  closeBundle() {
    for (const mode of ['shell', 'preview', 'globalSearch', 'alert', 'settings', 'guide']) {
      const htmlPath = resolve('out/renderer/onlypreview', mode, 'index.html');
      const html = readFileSync(htmlPath, 'utf8');
      const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
      if (
        !/^\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*<meta\s+charset=/i.test(head)
      ) {
        throw new Error(`OnlyPreview ${mode} CSP/charset are not the first two elements in <head>`);
      }
      if (html.toLowerCase().indexOf('<meta charset=') >= 1024) {
        throw new Error(`OnlyPreview ${mode} charset declaration is outside the first 1024 bytes`);
      }
      const supportsOffice = mode === 'preview' || mode === 'globalSearch';
      if (supportsOffice && !head.includes("'wasm-unsafe-eval'")) {
        throw new Error(`OnlyPreview ${mode} CSP must authorize same-origin OOXML WASM`);
      }
      if (!supportsOffice && head.includes("'wasm-unsafe-eval'")) {
        throw new Error(`OnlyPreview ${mode} must not inherit the OOXML WASM capability`);
      }
      if (supportsOffice && !head.includes("worker-src 'self' blob:")) {
        throw new Error(`OnlyPreview ${mode} CSP must authorize same-origin OOXML Workers`);
      }
      if (html.includes('"./monacoeditorwork/')) {
        throw new Error(`OnlyPreview ${mode} contains a nested broken Monaco worker path`);
      }
      const inlineScript = html.match(/<script>([\s\S]*?MonacoEnvironment[\s\S]*?)<\/script>/);
      if (!inlineScript) throw new Error(`OnlyPreview ${mode} Monaco bootstrap is missing`);
      const hash = createHash('sha256').update(inlineScript[1]).digest('base64');
      if (!head.includes(`'sha256-${hash}'`)) {
        throw new Error(`OnlyPreview ${mode} CSP does not authorize its exact Monaco bootstrap`);
      }
      const workerPaths = [...html.matchAll(/"(\.\.\/\.\.\/monacoeditorwork\/[^"]+)"/g)].map(
        (match) => match[1]
      );
      if (!workerPaths.length)
        throw new Error(`OnlyPreview ${mode} Monaco worker paths are missing`);
      for (const workerPath of new Set(workerPaths)) {
        if (!existsSync(resolve(dirname(htmlPath), workerPath))) {
          throw new Error(`OnlyPreview ${mode} Monaco worker is missing: ${workerPath}`);
        }
      }
    }
  }
};

const coinHtmlSecurityPlugin = {
  name: 'bitterless:coin-html-security',
  apply: 'build' as const,
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, context: { path: string }) {
      if (!context.path.includes('/coin/')) return html;
      return secureCoinHtml(html);
    }
  },
  closeBundle() {
    const htmlPath = resolve('out/renderer/coin/index.html');
    const html = readFileSync(htmlPath, 'utf8');
    const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
    if (!/^\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*<meta\s+charset=/i.test(head)) {
      throw new Error('Trench CSP/charset are not the first two elements in <head>');
    }
    if (html.toLowerCase().indexOf('<meta charset=') >= 1024) {
      throw new Error('Trench charset declaration is outside the first 1024 bytes');
    }
    if (html.includes('"./monacoeditorwork/')) {
      throw new Error('Trench contains a nested broken Monaco worker path');
    }
    const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((script) => script.trim().length > 0);
    for (const script of inlineScripts) {
      const hash = createHash('sha256').update(script).digest('base64');
      if (!head.includes(`'sha256-${hash}'`)) {
        throw new Error('Trench CSP does not authorize an exact inline script');
      }
    }
    const workerPaths = [...html.matchAll(/"(\.\.\/monacoeditorwork\/[^"]+)"/g)].map(
      (match) => match[1]
    );
    if (!workerPaths.length) throw new Error('Trench Monaco worker paths are missing');
    for (const workerPath of new Set(workerPaths)) {
      if (!existsSync(resolve(dirname(htmlPath), workerPath))) {
        throw new Error(`Trench Monaco worker is missing: ${workerPath}`);
      }
    }
  }
};

const generateEnvDefines = () => {
  const envRigPath = resolve('env.rig.json5');
  const envRigContent = readFileSync(envRigPath, 'utf-8');
  const envRigConfig = JSON5.parse(envRigContent);

  const debugDevKeys = Object.keys(envRigConfig.debug_dev || {});
  const defines: Record<string, string> = {};

  for (const key of debugDevKeys) {
    defines[`import.meta.env.${key}`] = JSON.stringify(process.env[key]);
  }

  return defines;
};

const runtimeProfileBuildMarkerPlugin = {
  name: 'bitterless:runtime-profile-build-marker',
  apply: 'build' as const,
  closeBundle() {
    writeFileSync(
      resolve('out/.bitterless-runtime-profile.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: canonicalRigEnvironment.profileName,
          releaseChannel: canonicalRigEnvironment.releaseChannel,
          viteEnv: canonicalRigEnvironment.viteEnv,
          viteMode: canonicalRigEnvironment.viteMode
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }
};

// Workflow code and Pi sessions execute in separate utility processes.
const workflowWorkerPlugin = {
  name: 'workflow:utility-workers',
  async writeBundle() {
    await esbuild({
      entryPoints: {
        'workflow-engine.worker': resolve('src/main/agent/workflowEngine/engine.worker.ts'),
        'workflow-agent.worker': resolve('src/main/agent/workflowEngine/agent.worker.ts')
      },
      outdir: resolve('out/main'),
      outExtension: { '.js': '.mjs' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      packages: 'external',
      // `packages: 'external'` leaves EVERY bare specifier alone — including our own `@shared` /
      // `@main` aliases, which are not packages at all. Without these the worker ships an
      // `import … from '@shared/…'` that Node cannot resolve, so the utilityProcess dies on load and
      // every run reports "Workflow process exited unexpectedly" with nothing else to go on.
      // (Ral 2026-09-21; the trigger was the workflow entry-name contract moving into shared.)
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
        '@renderer': resolve('src/renderer')
      },
      external: ['electron'],
      sourcemap: false
    })
  }
}

export default defineConfig({
  main: {
    plugins: [piSkillSdkPlugin(resolve('.')), runtimeProfileBuildMarkerPlugin, workflowWorkerPlugin],
    define: { ...generateEnvDefines() },
    build: {
      externalizeDeps: { exclude: bundledRuntimeDependencies },
      rollupOptions: {
        input: {
          'app.main': resolve('src/main/app.main.ts'),
          codexHookHelper: resolve('src/main/eyesOnAgents/codexHookHelper.main.ts'),
          claudeHookHelper: resolve('src/main/eyesOnAgents/claudeHookHelper.main.ts'),
          claudeDirectoryWatcher: resolve('src/main/eyesOnAgents/claudeDirectoryWatcher.main.ts'),
          mcpHelper: resolve('src/main/mcp/mcpHelper.main.ts')
        },
        // `canvas` 是 `linkedom` 的**可选 peer**(它的 package.json 里 peerDependenciesMeta.canvas.optional = true):
        // linkedom 只在你真去用 canvas 相关 API 时才需要它,而正文抽取(articleExtract)只用 DOM 解析。
        //
        // 但 `linkedom` 在 bundledRuntimeDependencies 里 = 被**打进** main bundle,于是 rollup 会跟着
        // 它的 import 图走进那个可选依赖并硬失败:`Could not resolve "canvas" imported by "linkedom"`。
        // 这个错误只有在**真的有人 import linkedom** 之后才会出现 —— 2026-09-11 加 web_fetch 时触发。
        // 标成 external:打包时不解析,运行时也不会被 require(那条分支走不到)。
        external: [/rig_dev\/.*\/node_modules/, 'node-llama-cpp', 'canvas']
      },
      bytecode: false
    },
    resolve: {
      alias: [
        { find: '@renderer', replacement: resolve('src/renderer') },
        { find: '@preload', replacement: resolve('src/preload') },
        { find: '@shared', replacement: resolve('src/shared') },
        { find: '@main', replacement: resolve('src/main') },
        { find: '@maestro-main', replacement: resolve('src/main/maestro') },
        { find: '@maestro-shared', replacement: resolve('src/shared/maestro') },
        // 别名引入,由 vite 打进 main chunk —— 不是 npm 包,不进 node_modules,不进 asar。
        // 目的是 agent 逻辑只有一处:改 SDK,cowork 与 bitterless 同时生效。
        // SDK 在仓外,裸模块从它那儿向上找不到本仓的 node_modules。`typebox` 在
        // bundledRuntimeDependencies 里(有意打包,不外置)⇒ rollup 必须真解析到它,
        // 于是要显式指路。这是 tsconfig.node.json 里那条 `"typebox"` paths 的打包器侧对应物,
        // 两处必须同时在,否则症状不同但都指向同一个原因:类型侧报"属性不存在",
        // 打包侧报 `Rollup failed to resolve import "typebox"`。
        // 精确匹配,别用前缀 —— typebox 的子路径导入不该被改写。
        // 其余裸模块不需要:pi-ai 全是 import type(擦除),pi-coding-agent 走外置。
        { find: /^typebox$/, replacement: resolve('node_modules/typebox') }
      ]
    },
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true
        }
      }
    }
  },
  preload: {
    plugins: [onlyPreviewSandboxPreloadPlugin, trenchSandboxPreloadPlugin],
    define: { ...bitterlessPreloadBuildDefine },
    build: {
      externalizeDeps: { exclude: bundledRuntimeDependencies },
      rollupOptions: {
        input: {
          home: resolve('src/preload/home/home.preload.ts'),
          sqlite: resolve('src/preload/sqlite/sqlite.preload.ts'),
          connector: resolve('src/preload/connector/connector.preload.ts'),
          llama: resolve('src/preload/llama/llama.preload.ts'),
          todo: resolve('src/preload/todo/todo.preload.ts'),
          eyesOnAgents: resolve('src/preload/eyesOnAgents/eyesOnAgents.preload.ts'),
          translator: resolve('src/preload/translator/translator.preload.ts'),
          motto: resolve('src/preload/motto/motto.preload.ts'),
          submodules: resolve('src/preload/submodules/submodules.preload.ts'),
          zellij: resolve('src/preload/zellij/zellij.preload.ts'),
          onlypreview: resolve('src/preload/onlypreview/onlypreview.preload.ts'),
          onlypreviewContent: resolve('src/preload/onlypreview/onlypreviewContent.preload.ts'),
          fileSearch: resolve('src/preload/fileSearch/fileSearch.preload.ts'),
          'trench-io': resolve('src/renderer/trench-io/trenchIo.preload.ts'),
          omni: resolve('src/preload/omni/omni.preload.ts'),
          omniCellContent: resolve('src/preload/omni/omniCellContent.preload.ts'),
          trench: resolve('src/preload/trench/trench.preload.ts'),
          maestroCoach: resolve('src/preload/maestro/coach.preload.ts'),
          maestroHistory: resolve('src/preload/maestro/history.preload.ts'),
          maestroLocalHome: resolve('src/preload/maestro/localHome.preload.ts'),
          maestroWorkbench: resolve('src/preload/maestro/workbench.preload.ts'),
          maestroSqlite: resolve('src/preload/maestro/sqlite.preload.ts')
        },
        external: [/rig_dev\/.*\/node_modules/, 'node-llama-cpp', 'playwright', 'playwright-core']
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/preload/renderer'),
        '@preload': resolve('src/preload'),
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
        '@maestro-main': resolve('src/main/maestro'),
        '@maestro-shared': resolve('src/shared/maestro')
      }
    },
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true
        }
      }
    }
  },
  renderer: {
    define: { ...generateEnvDefines() },
    /**
     * **Dev server 绑定到 `127.0.0.1`,不用默认的 `localhost`。** Cowork 侧同构,两份一起改。
     *
     * Vite 的默认 `host` 是 `localhost`,而 Node 17+ 的 DNS 顺序是 `verbatim` —— 开发机
     * `/etc/hosts` 同时有 `127.0.0.1 localhost` 与 `::1 localhost`,于是
     * `server.listen('localhost')` 只绑上**解析出来的第一个地址**。2026-09-22 在 Cowork 上实测:
     * `lsof -iTCP:5173` 只有 `TCP [::1]:5173 (LISTEN)`,`curl http://127.0.0.1:5173/…` 连不上。
     *
     * 而 `ELECTRON_RENDERER_URL` 是 `http://localhost:5173`(electron-vite 的 `resolveHostname`
     * 把 undefined 映射成字面量 `localhost`),renderer 里每条相对 import 都解析到这个**双栈名字**;
     * Chromium 会在两个地址族之间选/赛,于是同页面一部分请求走 `::1` 成功、一部分走 `127.0.0.1`
     * 被拒。症状是偶发的 `TypeError: Failed to fetch dynamically imported module`,而文档本身 200、
     * 模块图完好、服务器日志干净 —— 一个不指向任何真实代码问题的错误。
     * 排查记录:`micromeet-cowork:docs/issues/control-app-async-chunk-fetch-failure.md`。
     *
     * 绑死一个地址族就没有可选的余地。选 IPv4 而不是 `::1`:`host: true` / `0.0.0.0` 会把 dev
     * server 暴露到局域网,而 `[::1]` 形式的 origin 在别处更容易踩坑。
     */
    server: {
      host: '127.0.0.1'
    },
    build: {
      rollupOptions: {
        input: {
          home: resolve('src/renderer/home/index.html'),
          sqlite: resolve('src/renderer/sqlite/index.html'),
          connector: resolve('src/renderer/connector/index.html'),
          llama: resolve('src/renderer/llama/index.html'),
          todo: resolve('src/renderer/todo/index.html'),
          eyesOnAgents: resolve('src/renderer/eyesOnAgents/index.html'),
          translator: resolve('src/renderer/translator/index.html'),
          motto: resolve('src/renderer/motto/index.html'),
          submodules: resolve('src/renderer/submodules/index.html'),
          zellij: resolve('src/renderer/zellij/index.html'),
          'onlypreview/shell': resolve('src/renderer/onlypreview/shell/index.html'),
          filepreview: resolve('src/renderer/filepreview/index.html'),
          'onlypreview/preview': resolve('src/renderer/onlypreview/preview/index.html'),
          'onlypreview/globalSearch': resolve(
            'src/renderer/onlypreview/globalSearch/index.html'
          ),
          'onlypreview/alert': resolve('src/renderer/onlypreview/alert/index.html'),
          'onlypreview/settings': resolve('src/renderer/onlypreview/settings/index.html'),
          'onlypreview/guide': resolve('src/renderer/onlypreview/guide/index.html'),
          'onlypreview/detached': resolve('src/renderer/onlypreview/detached/index.html'),
          fileSearch: resolve('src/renderer/fileSearch/index.html'),
          'trench-io': resolve('src/renderer/trench-io/index.html'),
          'omni/omniCell': resolve('src/renderer/omni/omniCell/index.html'),
          'omni/omniControl': resolve('src/renderer/omni/omniControl/index.html'),
          'omni/omniWindow': resolve('src/renderer/omni/omniWindow/index.html'),
          coin: resolve('src/renderer/coin/index.html'),
          maestroHome: resolve('src/renderer/maestro/home/index.html'),
          maestroLocalHome: resolve('src/renderer/maestro/localHome/index.html'),
          maestroControl: resolve('src/renderer/maestro/control/index.html'),
          maestroWorkbench: resolve('src/renderer/maestro/workbench/index.html'),
          maestroTabAlias: resolve('src/renderer/maestro/tabAlias/index.html'),
          maestroHistory: resolve('src/renderer/maestro/history/index.html'),
          maestroSqlite: resolve('src/renderer/maestro/sqlite/index.html')
        }
      }
    },
    optimizeDeps: {
      exclude: ['@silurus/ooxml'],
      esbuildOptions: {
        tsconfigRaw: {
          compilerOptions: {
            experimentalDecorators: true
          }
        }
      }
    },
    worker: {
      format: 'es'
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@preload': resolve('src/preload'),
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
        '@maestro-main': resolve('src/main/maestro'),
        '@maestro-shared': resolve('src/shared/maestro'),
        '@maestro-renderer': resolve('src/renderer/maestro'),
        '@': resolve('src/renderer/home/src')
      }
    },
    plugins: [
      vue(),
      coinDevCspPlugin,
      translatorDevCspPlugin,
      mottoDevCspPlugin,
      submodulesDevCspPlugin,
      onlyPreviewDevCspPlugin,
      maestroSqliteDevCspPlugin,
      maestroOverlayDevCspPlugin,
      monacoEditorPlugin({
        // **只保留 `editorWorkerService`。** 不传这个选项时插件默认吐出全部 worker,
        // 于是产物里有一个 **12 MB 的 `ts.worker.bundle.js`** ＋ css/html/json 三个,
        // 合计 16 MB —— 而它们**一个消费者都没有**。
        //
        // 那些 worker 提供的是**语言服务**(补全、诊断、格式化),而 OnlyPreview 是一个**只读**
        // 预览器:本仓与 micromeet-cowork 里 `languages.typescript` / `typescriptDefaults` /
        // `registerCompletionItemProvider` / `setDiagnosticsOptions` / `getWorker` 一处都没有
        // (2026-09-08 实测)。而且**它们也不负责上色** —— 上色 2026-09-08 起由 shiki 的 TextMate
        // 语法做(`onlyPreviewHighlighter.service.ts`),在那之前由 monarch 在渲染进程里同步做,
        // 两者都不经过 worker。
        //
        // `editorWorkerService` 必须留:它做 diff 计算、链接检测这类编辑器核心工作,与语言无关。
        //
        // 哪天真要给某个语言加语言服务,把它加回这个数组即可 —— 代价就是那几 MB,而现在这个数组
        // 让代价成为一个显式选择,不再是一个没人问过的默认值。
        languageWorkers: ['editorWorkerService'],
        customDistPath: (_root, outDir) => resolve(outDir, 'monacoeditorwork')
      }),
      privilegedRuntimeBlankHtmlPlugin,
      privilegedRuntimeBlankHtmlAuditPlugin,
      onlyPreviewHtmlSecurityPlugin,
      coinHtmlSecurityPlugin
    ],
    css: {
      preprocessorOptions: {
        less: {
          modifyVars: theme,
          javascriptEnabled: true
        }
      }
    },
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true
        }
      }
    }
  }
});
