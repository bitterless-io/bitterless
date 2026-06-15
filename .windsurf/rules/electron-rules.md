---
trigger: always_on
description: 
globs: 
---

## Window Configuration Rules

**All application windows must have a minimum size of 800x600 pixels.**

```ts
const windowOptions: BrowserWindowConstructorOptions = {
  width: 1200,
  height: 800,
  minWidth: 800,   // Required
  minHeight: 600,  // Required
  // ... other options
};
```

This ensures consistent user experience and prevents windows from becoming too small to be usable.

## Inter-Process Communication Rules

**All communication between processes (Main ↔ Preload ↔ Renderer) must use the `electron-xpc` package.**

- Never use Electron's native `ipcMain`/`ipcRenderer` directly
- Never use `contextBridge.exposeInMainWorld` for function calls (only for static data)
- All bidirectional communication must go through XPC handlers and emitters

## ipc rules

IPC communication must use `electron-xpc` package.

### Main Layer

```ts
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main';

// --- Define Handler ---
class UserService extends XpcMainHandler {
  // ✅ 0 parameters — valid
  async getCount(): Promise<number> {
    return 42;
  }

  // ✅ 1 parameter — valid
  async getUserList(params: { page: number }): Promise<any[]> {
    return db.query('SELECT * FROM users LIMIT ?', [params.page]);
  }

  // ❌ 2+ parameters — will cause compile error on Emitter side
  // async search(keyword: string, page: number): Promise<any> { ... }
}

// Instantiate — auto registers:
//   xpc:UserService/getCount
//   xpc:UserService/getUserList
const userService = new UserService();
```

```ts
// --- Use Emitter (can be used in any layer) ---
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { UserService } from './somewhere';

const userEmitter = createXpcMainEmitter<UserService>('UserService');

const count = await userEmitter.getCount();           // sends to xpc:UserService/getCount
const list = await userEmitter.getUserList({ page: 1 }); // sends to xpc:UserService/getUserList
```

### Preload Layer

```ts
import { XpcPreloadHandler, createXpcPreloadEmitter } from 'electron-xpc/preload';

// --- Define Handler ---
class MessageTable extends XpcPreloadHandler {
  async getMessageList(params: { chatId: string }): Promise<any[]> {
    return sqlite.query('SELECT * FROM messages WHERE chatId = ?', [params.chatId]);
  }
}

// Instantiate — auto registers: xpc:MessageTable/getMessageList
const messageTable = new MessageTable();
```

```ts
// --- Use Emitter (can be used in other preload or web layer) ---
import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { MessageTable } from './somewhere';

const messageEmitter = createXpcPreloadEmitter<MessageTable>('MessageTable');
const messages = await messageEmitter.getMessageList({ chatId: '123' });
```

### Web Layer

```ts
import { XpcRendererHandler, createXpcRendererEmitter } from 'electron-xpc/renderer';

// --- Define Handler ---
class UINotification extends XpcRendererHandler {
  async showToast(params: { text: string }): Promise<void> {
    toast.show(params.text);
  }
}

const uiNotification = new UINotification();
```

```ts
// --- Use Emitter (can be used in other layers) ---
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { UINotification } from './somewhere';

const notifyEmitter = createXpcRendererEmitter<UINotification>('UINotification');
await notifyEmitter.showToast({ text: 'Hello!' });
```

## XPC Emitter Usage Rules

**Simple rules for using XPC emitters:**

1. **Always import the handler type** — Use `import type` to reference the handler class for type safety.

2. **Pass the exact handler class name as a string** — The emitter name must match the handler class name exactly.

3. **Emitters can be used across layers** — You can call handlers from any layer (main, preload, renderer) as long as the handler is registered.

4. **Handler methods must have 0 or 1 parameter** — If you need multiple values, wrap them in a single object parameter.

### Quick Reference

```ts
// Main layer: call main handlers
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { UserService } from './somewhere';
const emitter = createXpcMainEmitter<UserService>('UserService');
await emitter.getUserList({ page: 1 });

// Preload layer: call preload handlers
import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { MessageTable } from './somewhere';
const emitter = createXpcPreloadEmitter<MessageTable>('MessageTable');
await emitter.getMessageList({ chatId: '123' });

// Renderer layer: call renderer handlers
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { UINotification } from './somewhere';
const emitter = createXpcRendererEmitter<UINotification>('UINotification');
await emitter.showToast({ text: 'Hello!' });
```

### Common Patterns

```ts
// ✅ Create emitter once, reuse multiple times
const userEmitter = createXpcMainEmitter<UserService>('UserService');
const count = await userEmitter.getCount();
const list = await userEmitter.getUserList({ page: 1 });

// ✅ Call from different layer (e.g., renderer calls main handler)
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { AppHandler } from '@main/xpc/app.handler';
const appEmitter = createXpcMainEmitter<AppHandler>('AppHandler');
await appEmitter.getAppVersion();

// ❌ Wrong: handler name doesn't match class name
const emitter = createXpcMainEmitter<UserService>('User'); // Wrong!

// ❌ Wrong: missing type parameter
const emitter = createXpcMainEmitter('UserService'); // No type safety!
```

## Broadcast & Subscribe

Both `xpcMain` and `xpcRenderer` support fire-and-forget broadcast/subscribe for one-to-many notifications.

> **Key rules:**
> 1. The process that sends a broadcast will NOT receive it itself.
> 2. Subscribers receive `payload.params`, not direct params.

### Main process broadcasts to all renderers

```ts
import { xpcMain } from 'electron-xpc/main';

// Send to all renderer windows (main does NOT receive this itself)
xpcMain.broadcast('some/event', { data: 'value' });

// Main process subscribes to renderer broadcasts
xpcMain.subscribe('some/event', (payload) => {
  const { data } = payload.params;  // Access via payload.params
  console.log('received:', data);
});
```

### Renderer broadcasts to all other renderers + main can subscribe

```ts
import { xpcRenderer } from 'electron-xpc/renderer';

// Send to all OTHER renderer windows — the sender does NOT receive this
xpcRenderer.broadcast('some/event', { data: 'value' });

// Any renderer subscribes to broadcasts from other renderers or main
xpcRenderer.subscribe('some/event', (payload) => {
  const { data } = payload.params;  // Access via payload.params
  console.log('received:', data);
});
```

### Summary

| Sender | API | Receivers |
|---|---|---|
| Main | `xpcMain.broadcast(event, params)` | All renderer windows (not main) |
| Renderer | `xpcRenderer.broadcast(event, params)` | All OTHER renderer windows + main via `xpcMain.subscribe` (not the sender) |

## contextBridge rules

When passing data from **preload → renderer** via `contextBridge.exposeInMainWorld`, follow this 3-layer pattern:

### 1. Preload: define type + expose

```ts
// src/preload/todo/todo.preload.ts
import { contextBridge } from 'electron';

export interface TodoEnvApi {
  isStandalone: boolean;
}

const todoEnvApi: TodoEnvApi = {
  isStandalone: process.argv.includes('--mode=standalone'),
};

contextBridge.exposeInMainWorld('todoEnv', todoEnvApi);
```

### 2. Renderer contextBridge: typed re-export

Place in `src/renderer/<module>/src/contextBridge/<name>.bridge.ts`:

```ts
// src/renderer/todo/src/contextBridge/todoEnv.bridge.ts
import type { TodoEnvApi } from '@preload/todo/todo.preload';

export const todoEnv = (globalThis as any).todoEnv as TodoEnvApi;
```

### 3. Renderer usage: import directly

```ts
import { todoEnv } from './contextBridge/todoEnv.bridge';

const standalone = todoEnv.isStandalone;
```

> **Key points:**
> - Type is defined once in preload and shared via `import type`.
> - Renderer never accesses `window.*` directly — always import from `contextBridge/*.bridge.ts`.
> - No `Window` interface augmentation in `env.d.ts` needed.

## shared style rules

Every renderer app must import the shared theme stylesheet in its `main.ts`:

```ts
import '@renderer/common/assets/style/theme.less';
```

This ensures consistent global styles (scrollbar, layout, font-size) across all windows.