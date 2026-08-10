import { dirname, resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { config as dotenvConfig } from 'dotenv'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm'
import theme from './theme'
import { existsSync, readFileSync } from 'fs'
import JSON5 from 'json5'
import { build as esbuild } from 'esbuild'
import { createHash } from 'crypto'

dotenvConfig({ path: resolve('.env.rig') })

const packageMetadata = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
  version_code?: unknown
}
if (
  typeof packageMetadata.version_code !== 'string' ||
  !/^\d{12}$/.test(packageMetadata.version_code)
) {
  throw new Error('package.json version_code must be a 12-digit string')
}

const bitterlessPreloadBuildDefine = {
  __BITTERLESS_VERSION_CODE__: JSON.stringify(packageMetadata.version_code),
  'import.meta.env.VITE_BITTERLESS_CORE_URL': JSON.stringify(
    process.env.VITE_BITTERLESS_CORE_URL || ''
  ),
  'import.meta.env.VITE_ENV': JSON.stringify(process.env.VITE_ENV || 'dev')
}

const maestroBuildDefine = {
  __COACH_BUILD_REGION__: JSON.stringify(process.env.VITE_COACH_REGION || 'SG'),
  __COACH_AI_CRMS_RELAY_BASE_URL__: JSON.stringify(process.env.VITE_COACH_AI_CRMS_RELAY_BASE_URL || ''),
  __COACH_AI_CRMS_RELAY_BASE_URL_SG__: JSON.stringify(process.env.VITE_COACH_AI_CRMS_RELAY_BASE_URL_SG || ''),
  __COACH_AI_CRMS_RELAY_BASE_URL_HK__: JSON.stringify(process.env.VITE_COACH_AI_CRMS_RELAY_BASE_URL_HK || ''),
  __COACH_AI_CRMS_RELAY_BASE_URL_ID__: JSON.stringify(process.env.VITE_COACH_AI_CRMS_RELAY_BASE_URL_ID || '')
}

const bundledRuntimeDependencies = [
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
]

const maestroSqliteDevCspPlugin = {
  name: 'bitterless:maestro-sqlite-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/maestro/sqlite/')) return html
    return html.replace(
      /(<meta http-equiv="Content-Security-Policy" content=")default-src 'none'("\s*\/>)/,
      "$1default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* wss://localhost:*$2"
    )
  }
}

const coinDevCspPlugin = {
  name: 'bitterless:coin-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/coin/')) return html
    return html.replace(
      "connect-src 'none'",
      "connect-src 'self' ws://localhost:* wss://localhost:*"
    )
  }
}

const translatorDevCspPlugin = {
  name: 'bitterless:translator-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/translator/')) return html
    return html.replace(
      "connect-src 'none'",
      "connect-src 'self' ws://localhost:* wss://localhost:*"
    )
  }
}

const mottoDevCspPlugin = {
  name: 'bitterless:motto-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/motto/')) return html
    return html.replace(
      "connect-src 'none'",
      "connect-src 'self' ws://localhost:* wss://localhost:*"
    )
  }
}

const onlyPreviewDevCspPlugin = {
  name: 'bitterless:onlypreview-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('/onlypreview/')) return html
    return html
      .replace(
        "connect-src 'self' bitterless-preview:",
        "connect-src 'self' bitterless-preview: ws://localhost:* wss://localhost:*"
      )
      .replace(
        "connect-src 'none'",
        "connect-src 'self' ws://localhost:* wss://localhost:*"
      )
  }
}

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
      define: bitterlessPreloadBuildDefine,
      sourcemap: false,
      logLevel: 'silent'
    })
  }
}

const secureOnlyPreviewHtml = (source: string): string => {
  let html = source.replaceAll('./monacoeditorwork/', '../../monacoeditorwork/')
  const inlineScript = html.match(/<script>([\s\S]*?MonacoEnvironment[\s\S]*?)<\/script>/)
  const cspMeta = html.match(
    /\s*<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i
  )
  if (!cspMeta) throw new Error('OnlyPreview renderer is missing its Content-Security-Policy meta')
  let csp = cspMeta[1]
  if (inlineScript) {
    const hash = createHash('sha256').update(inlineScript[1]).digest('base64')
    csp = csp.replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`)
  }
  html = html.replace(cspMeta[0], '')
  return html.replace(
    /<head>/i,
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
  )
}

const onlyPreviewHtmlSecurityPlugin = {
  name: 'bitterless:onlypreview-html-security',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, context: { path: string }) {
      if (!context.path.includes('/onlypreview/')) return html
      return secureOnlyPreviewHtml(html)
    }
  },
  closeBundle() {
    for (const mode of ['shell', 'previewHeader', 'preview', 'settings', 'guide']) {
      const htmlPath = resolve('out/renderer/onlypreview', mode, 'index.html')
      const html = readFileSync(htmlPath, 'utf8')
      const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? ''
      if (!/^\s*<meta\s+http-equiv="Content-Security-Policy"/i.test(head)) {
        throw new Error(`OnlyPreview ${mode} CSP is not the first element in <head>`)
      }
      if (html.includes('"./monacoeditorwork/')) {
        throw new Error(`OnlyPreview ${mode} contains a nested broken Monaco worker path`)
      }
      const inlineScript = html.match(/<script>([\s\S]*?MonacoEnvironment[\s\S]*?)<\/script>/)
      if (!inlineScript) throw new Error(`OnlyPreview ${mode} Monaco bootstrap is missing`)
      const hash = createHash('sha256').update(inlineScript[1]).digest('base64')
      if (!head.includes(`'sha256-${hash}'`)) {
        throw new Error(`OnlyPreview ${mode} CSP does not authorize its exact Monaco bootstrap`)
      }
      const workerPaths = [...html.matchAll(/"(\.\.\/\.\.\/monacoeditorwork\/[^"]+)"/g)]
        .map((match) => match[1])
      if (!workerPaths.length) throw new Error(`OnlyPreview ${mode} Monaco worker paths are missing`)
      for (const workerPath of new Set(workerPaths)) {
        if (!existsSync(resolve(dirname(htmlPath), workerPath))) {
          throw new Error(`OnlyPreview ${mode} Monaco worker is missing: ${workerPath}`)
        }
      }
    }
  }
}

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
}

export default defineConfig({
  main: {
    define: { ...generateEnvDefines(), ...maestroBuildDefine },
    build: {
      externalizeDeps: { exclude: bundledRuntimeDependencies },
      rollupOptions: {
        input: {
          'app.main': resolve('src/main/app.main.ts'),
          codexHookHelper: resolve('src/main/eyesOnAgents/codexHookHelper.main.ts'),
          mcpHelper: resolve('src/main/mcp/mcpHelper.main.ts'),
          onlypreviewSearchUtility: resolve('src/utility/onlypreview/onlyPreviewSearch.utility.ts')
        },
        external: [/rig_dev\/.*\/node_modules/, 'node-llama-cpp']
      },
      bytecode: false
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
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
  preload: {
    plugins: [onlyPreviewSandboxPreloadPlugin],
    define: { ...maestroBuildDefine, ...bitterlessPreloadBuildDefine },
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
          onlypreview: resolve('src/preload/onlypreview/onlypreview.preload.ts'),
          onlypreviewContent: resolve('src/preload/onlypreview/onlypreviewContent.preload.ts'),
          omni: resolve('src/preload/omni/omni.preload.ts'),
          omniCellContent: resolve('src/preload/omni/omniCellContent.preload.ts'),
          coin: resolve('src/preload/coin/coin.preload.ts'),
          maestroCoach: resolve('src/preload/maestro/coach.preload.ts'),
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
    define: maestroBuildDefine,
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
          'onlypreview/shell': resolve('src/renderer/onlypreview/shell/index.html'),
          'onlypreview/previewHeader': resolve('src/renderer/onlypreview/previewHeader/index.html'),
          'onlypreview/preview': resolve('src/renderer/onlypreview/preview/index.html'),
          'onlypreview/settings': resolve('src/renderer/onlypreview/settings/index.html'),
          'onlypreview/guide': resolve('src/renderer/onlypreview/guide/index.html'),
          'omni/omniCell': resolve('src/renderer/omni/omniCell/index.html'),
          'omni/omniControl': resolve('src/renderer/omni/omniControl/index.html'),
          'omni/omniWindow': resolve('src/renderer/omni/omniWindow/index.html'),
          coin: resolve('src/renderer/coin/index.html'),
          maestroHome: resolve('src/renderer/maestro/home/index.html'),
          maestroControl: resolve('src/renderer/maestro/control/index.html'),
          maestroWorkbench: resolve('src/renderer/maestro/workbench/index.html'),
          maestroSqlite: resolve('src/renderer/maestro/sqlite/index.html')
        }
      }
    },
    optimizeDeps: {
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
      onlyPreviewDevCspPlugin,
      maestroSqliteDevCspPlugin,
      monacoEditorPlugin({ customDistPath: (_root, outDir) => resolve(outDir, 'monacoeditorwork') }),
      onlyPreviewHtmlSecurityPlugin
    ],
    css: {
      preprocessorOptions: {
        less: {
          modifyVars: theme,
          javascriptEnabled: true,
        },
      },
    },
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true
        }
      }
    }
  }
})
