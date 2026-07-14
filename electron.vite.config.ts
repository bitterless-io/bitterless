import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { config as dotenvConfig } from 'dotenv'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm'
import tailwindcss from '@tailwindcss/vite'
import theme from './theme'
import { readFileSync } from 'fs'
import JSON5 from 'json5'

dotenvConfig({ path: resolve('.env.rig') })

const coworkBuildDefine = {
  __COACH_BUILD_REGION__: JSON.stringify(process.env.VITE_COACH_REGION || 'SG'),
  __COACH_AI_CRMS_RELAY_BASE_URL__: JSON.stringify(process.env.VITE_COACH_AI_CRMS_RELAY_BASE_URL || ''),
  __COACH_AI_CRMS_RELAY_BASE_URL_SG__: JSON.stringify(process.env.VITE_COACH_AI_CRMS_RELAY_BASE_URL_SG || ''),
  __COACH_AI_CRMS_RELAY_BASE_URL_HK__: JSON.stringify(process.env.VITE_COACH_AI_CRMS_RELAY_BASE_URL_HK || ''),
  __COACH_AI_CRMS_RELAY_BASE_URL_ID__: JSON.stringify(process.env.VITE_COACH_AI_CRMS_RELAY_BASE_URL_ID || '')
}

const coworkSqliteDevCspPlugin = {
  name: 'bitterless:cowork-sqlite-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string, context: { path: string }) {
    if (!context.path.includes('coworkSqlite')) return html
    return html.replace(
      /(<meta http-equiv="Content-Security-Policy" content=")default-src 'none'("\s*\/>)/,
      "$1default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* wss://localhost:*$2"
    )
  }
}

function generateEnvDefines() {
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
    define: { ...generateEnvDefines(), ...coworkBuildDefine },
    build: {
      rollupOptions: {
        input: {
          'app.main': resolve('src/main/app.main.ts'),
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
        '@cowork-main': resolve('src/cowork/main'),
        '@cowork-shared': resolve('src/cowork/shared')
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
    define: coworkBuildDefine,
    build: {
      rollupOptions: {
        input: {
          home: resolve('src/preload/home/home.preload.ts'),
          sqlite: resolve('src/preload/sqlite/sqlite.preload.ts'),
          connector: resolve('src/preload/connector/connector.preload.ts'),
          llama: resolve('src/preload/llama/llama.preload.ts'),
          todo: resolve('src/preload/todo/todo.preload.ts'),
          omni: resolve('src/preload/omni/omni.preload.ts'),
          omniCellContent: resolve('src/preload/omni/omniCellContent.preload.ts'),
          coworkCoach: resolve('src/cowork/preload/coach.preload.ts'),
          coworkSqlite: resolve('src/cowork/preload/sqlite.preload.ts')
        },
        external: [/rig_dev\/.*\/node_modules/, 'node-llama-cpp', /tiktoken/, /js-tiktoken/, 'linkedom', '@mozilla/readability', 'playwright', 'playwright-core']
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/preload/renderer'),
        '@preload': resolve('src/preload'),
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
        '@cowork-main': resolve('src/cowork/main'),
        '@cowork-shared': resolve('src/cowork/shared')
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
    define: coworkBuildDefine,
    build: {
      rollupOptions: {
        input: {
          home: resolve('src/renderer/home/index.html'),
          sqlite: resolve('src/renderer/sqlite/index.html'),
          connector: resolve('src/renderer/connector/index.html'),
          llama: resolve('src/renderer/llama/index.html'),
          todo: resolve('src/renderer/todo/index.html'),
          'omni/omniCell': resolve('src/renderer/omni/omniCell/index.html'),
          'omni/omniControl': resolve('src/renderer/omni/omniControl/index.html'),
          'omni/omniWindow': resolve('src/renderer/omni/omniWindow/index.html'),
          coworkHome: resolve('src/renderer/coworkHome/index.html'),
          coworkControl: resolve('src/renderer/coworkControl/index.html'),
          coworkWorkbench: resolve('src/renderer/coworkWorkbench/index.html'),
          coworkSqlite: resolve('src/renderer/coworkSqlite/index.html')
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
        '@cowork-main': resolve('src/cowork/main'),
        '@cowork-shared': resolve('src/cowork/shared'),
        '@cowork-renderer': resolve('src/cowork/renderer'),
        '@': resolve('src/renderer/home/src')
      }
    },
    plugins: [
      vue(),
      tailwindcss(),
      coworkSqliteDevCspPlugin,
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
