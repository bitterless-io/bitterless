import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/explicit-function-return-type */

const ELECTRON_STATE_KEY = '__bitterlessMcpTestElectronState';
const XPC_STATE_KEY = '__bitterlessMcpTestXpcState';
const TODO_REPOSITORY_STATE_KEY = '__bitterlessMcpTestTodoRepositoryState';

const toDataUrl = (source) => {
  return `data:text/javascript,${encodeURIComponent(source)}`;
};

export const installMcpSourceHooks = ({
  projectRoot,
  userDataPath,
  emitters = {},
  broadcasts = [],
  todoRepository = null
}) => {
  globalThis[ELECTRON_STATE_KEY] = { userDataPath };
  globalThis[XPC_STATE_KEY] = { broadcasts, emitters };
  globalThis[TODO_REPOSITORY_STATE_KEY] = { todoRepository };

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
  const todoRepositoryUrl = toDataUrl(`
    const state = globalThis.${TODO_REPOSITORY_STATE_KEY};
    export const todoistSyncSession = {
      getRepository() {
        if (!state.todoRepository) {
          throw new Error('[todoist sync] no eligible customer session is active');
        }
        return state.todoRepository;
      }
    };
  `);

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'electron') return { shortCircuit: true, url: electronUrl };
      if (specifier === 'electron-xpc/main') return { shortCircuit: true, url: xpcUrl };
      if (specifier === '@main/todoistSync/todoistSync.session') {
        return { shortCircuit: true, url: todoRepositoryUrl };
      }
      if (specifier.startsWith('@main/')) {
        const sourcePath = join(projectRoot, 'src', 'main', `${specifier.slice(6)}.ts`);
        return { shortCircuit: true, url: pathToFileURL(sourcePath).href };
      }
      if (specifier.startsWith('@shared/')) {
        const sourcePath = join(projectRoot, 'src', 'shared', `${specifier.slice(8)}.ts`);
        return { shortCircuit: true, url: pathToFileURL(sourcePath).href };
      }
      return nextResolve(specifier, context);
    }
  });
};
