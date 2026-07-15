import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/explicit-function-return-type */

const ELECTRON_STATE_KEY = '__bitterlessMcpTestElectronState';
const XPC_STATE_KEY = '__bitterlessMcpTestXpcState';

const toDataUrl = (source) => {
  return `data:text/javascript,${encodeURIComponent(source)}`;
};

export const installMcpSourceHooks = ({
  projectRoot,
  userDataPath,
  emitters = {},
  broadcasts = []
}) => {
  globalThis[ELECTRON_STATE_KEY] = { userDataPath };
  globalThis[XPC_STATE_KEY] = { broadcasts, emitters };

  const electronUrl = toDataUrl(`
    const state = globalThis.${ELECTRON_STATE_KEY};
    export const app = {
      getPath(name) {
        if (name !== 'userData') throw new Error('Unexpected Electron path request: ' + name);
        return state.userDataPath;
      },
      quit() {}
    };
  `);
  const xpcUrl = toDataUrl(`
    const state = globalThis.${XPC_STATE_KEY};
    export const createXpcMainEmitter = (name) => {
      const emitter = state.emitters[name];
      if (!emitter) throw new Error('Missing test XPC emitter: ' + name);
      return emitter;
    };
    export const xpcMain = {
      broadcast(name, payload) {
        state.broadcasts.push({ name, payload });
      }
    };
  `);

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'electron') return { shortCircuit: true, url: electronUrl };
      if (specifier === 'electron-xpc/main') return { shortCircuit: true, url: xpcUrl };
      if (specifier.startsWith('@shared/')) {
        const sourcePath = join(projectRoot, 'src', 'shared', `${specifier.slice(8)}.ts`);
        return { shortCircuit: true, url: pathToFileURL(sourcePath).href };
      }
      return nextResolve(specifier, context);
    }
  });
};
