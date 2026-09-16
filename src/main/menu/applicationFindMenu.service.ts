import { BaseWindow, Menu, webContents } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';

export type ApplicationFindCommand = 'find-in-file' | 'focus-search';

export interface ApplicationFindDispatch {
  (command: ApplicationFindCommand, window: BaseWindow | null): boolean;
}

let dispatch: ApplicationFindDispatch | null = null;
const fileTabDispatches = new Set<ApplicationFindDispatch>();
let sessionSearchDispatch: ((window: BaseWindow | null) => boolean) | null = null;
let installedMenu: Menu | null = null;

export const setApplicationFindDispatch = (next: ApplicationFindDispatch | null): void => {
  dispatch = next;
};

export const registerApplicationFindDispatch = (next: ApplicationFindDispatch): (() => void) => {
  fileTabDispatches.add(next);
  return () => {
    fileTabDispatches.delete(next);
  };
};

/** Both native key events and the menu must choose a single foreground search owner. */
export const dispatchApplicationFindCommand = (
  command: ApplicationFindCommand,
  window: BaseWindow | null = BaseWindow.getFocusedWindow() ?? null
): boolean => {
  for (const target of fileTabDispatches) {
    if (target(command, window)) return true;
  }
  return dispatch?.(command, window) ?? false;
};

/** Call only for an active surface. Explicit Chat/other-view focus overrides the active tab. */
export const isApplicationFindFocusWithin = (
  window: BaseWindow,
  ownedContents: WeakSet<WebContents>
): boolean => {
  const focused = webContents.getFocusedWebContents();
  if (!focused || focused.isDestroyed()) return true;
  // Browser chrome (or no first responder yet) delegates to its active content.
  if ('webContents' in window && window.webContents === focused) return true;
  // Chromium's PDF viewer can hold focus in a guest of the preview's WebContents.
  for (let current: WebContents | null = focused; current; current = current.hostWebContents) {
    if (ownedContents.has(current)) return true;
  }
  return false;
};

export const setApplicationSessionSearchDispatch = (
  next: ((window: BaseWindow | null) => boolean) | null
): void => {
  sessionSearchDispatch = next;
};

// macOS resolves every Command chord through the main menu's key-equivalent path first, and only
// hands it to the key window's first responder when no menu item claims it. A BaseWindow made of
// WebContentsViews has no guaranteed first responder: a PDF renders inside an out-of-process
// plugin frame, and a freshly attached view can hold no keyboard focus at all. That makes
// `before-input-event` an unreliable carrier for Command+F — it fires only when some web contents
// already owns focus. A menu accelerator is the mechanism AppKit guarantees: it is delivered
// whenever this application is frontmost, whatever holds focus inside it.
const runFindCommand = (command: ApplicationFindCommand): void => {
  const window = BaseWindow.getFocusedWindow() ?? null;
  const focused = webContents.getFocusedWebContents() ?? null;
  const handled = dispatchApplicationFindCommand(command, window);
  console.info(
    `[onlypreview] event=menu-find command=${command} window=${window ? 'focused' : 'none'} focus=${focused ? 'view' : 'none'} handled=${handled}`
  );
  if (handled) return;
  if (command === 'find-in-file' && sessionSearchDispatch?.(window)) return;
  forwardToFocusedContents(command, focused);
};

// Other windows own Command+F through their own renderer keydown handlers (chat message search,
// the submodules window). A menu accelerator preempts those handlers, so an unclaimed chord is
// re-delivered to whichever web contents had focus. Without this, installing the menu would take
// Command+F away from every window that is not OnlyPreview.
const forwardToFocusedContents = (
  command: ApplicationFindCommand,
  focused: Electron.WebContents | null
): void => {
  if (!focused || focused.isDestroyed()) return;
  try {
    const modifiers: Electron.KeyboardInputEvent['modifiers'] =
      command === 'focus-search' ? ['meta', 'shift'] : ['meta'];
    focused.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers });
    focused.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers });
  } catch {
    // The focused contents went away between the menu click and the replay.
  }
};

const editSubmenu = (): MenuItemConstructorOptions[] => [
  { role: 'undo' },
  { role: 'redo' },
  { type: 'separator' },
  { role: 'cut' },
  { role: 'copy' },
  { role: 'paste' },
  { role: 'pasteAndMatchStyle' },
  { role: 'delete' },
  { role: 'selectAll' },
  { type: 'separator' },
  {
    label: 'Find…',
    accelerator: 'Command+F',
    click: () => {
      runFindCommand('find-in-file');
    }
  },
  {
    label: 'Find in Project…',
    accelerator: 'Shift+Command+F',
    click: () => {
      runFindCommand('focus-search');
    }
  }
];

// The application currently ships no menu of its own, so macOS installs Electron's default one.
// Every role below is a member of that default template — the Find section is the only addition,
// which keeps Command+C, Command+Q, Command+R and the rest exactly where they were.
export const buildApplicationFindMenuTemplate = (): MenuItemConstructorOptions[] => [
  { role: 'appMenu' },
  { role: 'fileMenu' },
  { label: 'Edit', submenu: editSubmenu() },
  { role: 'viewMenu' },
  { role: 'windowMenu' }
];

export const installApplicationFindMenu = (): void => {
  // Windows and Linux show an application menu as an in-window menu bar, which would put a visible
  // strip inside every frameless Bitterless window. Those platforms also deliver Ctrl chords to the
  // focused web contents without a menu, so `before-input-event` already carries them.
  if (process.platform !== 'darwin' || installedMenu) return;
  installedMenu = Menu.buildFromTemplate(buildApplicationFindMenuTemplate());
  Menu.setApplicationMenu(installedMenu);
  console.info('[onlypreview] event=menu-installed accelerators=cmd-f,shift-cmd-f');
};
