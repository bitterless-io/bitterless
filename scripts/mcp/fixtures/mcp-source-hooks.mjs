import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/* eslint-disable @typescript-eslint/explicit-function-return-type */

const ELECTRON_STATE_KEY = '__bitterlessMcpTestElectronState';
const XPC_STATE_KEY = '__bitterlessMcpTestXpcState';

const toDataUrl = (source) => {
  return `data:text/javascript,${encodeURIComponent(source)}`;
};

const requireTodoRepositoryMethod = (repository, name) => {
  const method = repository?.[name];
  if (typeof method !== 'function') {
    throw new Error('[todoist sync] no eligible customer session is active');
  }
  return method.bind(repository);
};

const mutationParams = (request) => {
  if (!request || request.originRendererId !== null || !Object.hasOwn(request, 'params')) {
    throw new Error('MCP Todo mutations must cross XPC with a null renderer origin');
  }
  return request.params;
};

const mutationContext = (request) => ({ originRendererId: request.originRendererId });

const runMutation = async (operation) => {
  await operation();
};

const createTodoRepositoryEmitters = (repository) => {
  if (!repository) return {};
  const call = (name, ...args) => requireTodoRepositoryMethod(repository, name)(...args);
  return {
    TodoistSyncDomainHandler: {
      create: (request) => call('createDomain', mutationParams(request), mutationContext(request)),
      getAll: () => call('getDomains'),
      getById: (params) => call('getDomainById', params),
      updateTitle: (request) => runMutation(() => (
        call('updateDomainTitle', mutationParams(request), mutationContext(request))
      )),
      updateDescription: (request) => runMutation(() => (
        call('updateDomainDescription', mutationParams(request), mutationContext(request))
      )),
      hardDelete: (request) => runMutation(() => (
        call('deleteDomain', mutationParams(request), mutationContext(request))
      )),
      setArchived: (request) => runMutation(() => (
        call('setDomainArchived', mutationParams(request), mutationContext(request))
      )),
      restore: (request) => call('restoreDomain', mutationParams(request), mutationContext(request))
    },
    TodoistSyncTodoHandler: {
      create: (request) => call('createTodo', mutationParams(request), mutationContext(request)),
      getByDomainId: (params) => call('getTodosByDomain', params),
      getById: (params) => call('getTodoById', params),
      getStatusByIds: (params) => call('getStatusByIds', params),
      update: (request) => call('updateTodo', mutationParams(request), mutationContext(request)),
      updateRepeatType: (request) => call('updateRepeatType', mutationParams(request), mutationContext(request)),
      updateRepeatInterval: (request) => call('updateRepeatInterval', mutationParams(request), mutationContext(request)),
      completeTodo: (request) => call('completeTodo', mutationParams(request), mutationContext(request)),
      uncompleteTodo: (request) => call('uncompleteTodo', mutationParams(request), mutationContext(request)),
      toggleImportant: (request) => call('toggleImportant', mutationParams(request), mutationContext(request)),
      hardDelete: (request) => {
        const params = mutationParams(request);
        return call('deleteTodo', params.id, {
          actor: params.actor,
          context: mutationContext(request)
        });
      },
      moveToDomain: (request) => call('moveToDomain', mutationParams(request), mutationContext(request)),
      getSortOrder: (params) => call('getSortOrder', params),
      setSortOrder: (request) => runMutation(() => (
        call('setSortOrder', mutationParams(request), mutationContext(request))
      )),
      skipToCurrent: (request) => call('skipToCurrent', mutationParams(request), mutationContext(request))
    },
    TodoistSyncSubTodoHandler: {
      create: (request) => call('createSubTodo', mutationParams(request), mutationContext(request)),
      getByTodoId: (params) => call('getSubTodosByTodoId', params),
      getById: (params) => call('getSubTodoById', params),
      updateTitle: (request) => runMutation(() => (
        call('updateSubTodoTitle', mutationParams(request), mutationContext(request))
      )),
      setStatus: (request) => call('setSubTodoStatus', mutationParams(request), mutationContext(request)),
      toggleStatus: (request) => call('toggleSubTodoStatus', mutationParams(request), mutationContext(request)),
      getCountByTodoId: (params) => call('getCountByTodoId', params),
      getCountsByTodoIds: (params) => call('getCountsByTodoIds', params),
      hardDelete: (request) => runMutation(() => (
        call('deleteSubTodo', mutationParams(request), mutationContext(request))
      ))
    },
    TodoistSyncEventHandler: {
      listAfter: (params) => call('listAfter', params)
    }
  };
};

export const installMcpSourceHooks = ({
  projectRoot,
  userDataPath,
  emitters = {},
  broadcasts = [],
  todoRepository = null,
  normalizeUndefinedXpcResultsToNull = false
}) => {
  globalThis[ELECTRON_STATE_KEY] = { userDataPath };
  globalThis[XPC_STATE_KEY] = {
    broadcasts,
    emitters: {
      ...createTodoRepositoryEmitters(todoRepository),
      ...emitters
    },
    normalizeUndefinedXpcResultsToNull
  };

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
      if (!state.normalizeUndefinedXpcResultsToNull) return emitter;
      return new Proxy(emitter, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (typeof value !== 'function') return value;
          return async (...args) => {
            const result = await value.apply(target, args);
            return result === undefined ? null : result;
          };
        }
      });
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
      if (
        specifier === './todoSqlite.client' &&
        context.parentURL?.endsWith('/src/main/mcp/mcpBridge.server.ts')
      ) {
        return {
          shortCircuit: true,
          url: pathToFileURL(join(projectRoot, 'src/main/mcp/todoSqlite.client.ts')).href
        };
      }
      if (specifier.startsWith('@main/')) {
        const sourcePath = join(projectRoot, 'src', 'main', `${specifier.slice(6)}.ts`);
        return { shortCircuit: true, url: pathToFileURL(sourcePath).href };
      }
      if (specifier.startsWith('@shared/')) {
        const sourcePath = join(projectRoot, 'src', 'shared', `${specifier.slice(8)}.ts`);
        return { shortCircuit: true, url: pathToFileURL(sourcePath).href };
      }
      if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') &&
        !/\.(?:[cm]?js|json|ts)$/.test(specifier)) {
        return {
          shortCircuit: true,
          url: pathToFileURL(resolve(dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`)).href
        };
      }
      return nextResolve(specifier, context);
    }
  });
};
