import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { config as dotenvConfig } from 'dotenv'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm'
import theme from './theme'
import { readFileSync } from 'fs'
import JSON5 from 'json5'

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
          mcpHelper: resolve('src/main/mcp/mcpHelper.main.ts')
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
      maestroSqliteDevCspPlugin,
      monacoEditorPlugin({ customDistPath: (_root, outDir) => resolve(outDir, 'monacoeditorwork') })
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
