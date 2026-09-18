export const ZELLIJ_STATE_EVENT = 'zellij/state' as const;
export const ZELLIJ_SURFACE_STATE_EVENT = 'zellij/surface-state' as const;
export const ZELLIJ_SETTINGS_OPEN_EVENT = 'zellij/settings-open' as const;
export const ZELLIJ_HANDLER_NAME = 'ZellijHandler' as const;
export const ZELLIJ_WINDOW_HANDLER_NAME = 'ZellijWindowHandler' as const;

/**
 * Query parameter carrying a chrome's own surface id (`zellij/index.html?surface=<id>`).
 *
 * Several Zellij surfaces can be live at once, each with its own chrome renderer, and every one of
 * them talks to the same main-side handler. The id has to be on the wire for main to know which
 * terminal a measurement is about.
 */
export const ZELLIJ_SURFACE_QUERY = 'surface' as const;

/**
 * chrome 那条工具条的高度(px)—— 也就是「终端从哪一行开始」。
 *
 * 和 Cowork 地址栏一致(`MenuBar.less` 的 `.maestro-menu-bar__address-row` 也是 42,Ral 2026-09-18)。
 *
 * 一个常量两处消费:main 用它做 `contentBounds` 的**首帧兜底**,渲染层在 `main.ts` 里把它写成 CSS
 * 变量 `--zellij-chrome-height` 交给 Less。各写一个字面量的话,漂移**不会报错** —— 首帧之后渲染层的
 * `ResizeObserver` 会用真实矩形盖掉那个兜底值,错的那一帧只是闪一下
 * (docs/features/zellij-terminal-chrome.md #2)。
 */
export const ZELLIJ_CHROME_HEIGHT = 42 as const;

/**
 * chrome 的背景色 —— 与终端自己的 `web_client.theme.background` **同一个字面值**。
 *
 * 用在两处「CSS 还没生效」的地方:chrome `WebContentsView` 与独立窗口的 `backgroundColor`。不设的话
 * 打开时先闪一帧 Chromium/Electron 默认的白屏,在这套配色下非常刺眼。
 *
 * 它在三个地方出现(这里、`App.less`、`zellijDefaultConfig.constant.ts` 的 KDL),由
 * `tests/zellij/zellijChromeTheme.test.mjs` 逐值比对钉住 —— Less 没法 import TS,KDL 是一段模板字符串,
 * 所以重复消不掉,只能守住(docs/features/zellij-terminal-chrome.md #1.1)。
 */
export const ZELLIJ_CHROME_BACKGROUND = '#1a1b26' as const;

export type ZellijErrorCode =
  | 'binary-missing'
  | 'unsupported-platform'
  | 'port-occupied'
  | 'version-mismatch'
  | 'web-sharing-disabled'
  | 'start-failed'
  | 'startup-timeout'
  | 'controls-load-timeout'
  | 'terminal-load-timeout'
  | 'controls-load-failed'
  | 'terminal-load-failed'
  | 'authentication-failed'
  | 'token-failed'
  | 'secure-storage-unavailable'
  | 'config-invalid'
  | 'config-drift'
  | 'config-validation-failed'
  | 'config-write-failed'
  | 'shortcut-invalid'
  | 'shortcut-conflict'
  | 'directory-missing'
  | 'directory-open-failed'
  | 'operation-failed';

export interface ZellijSnapshot {
  status: 'idle' | 'starting' | 'ready' | 'reconnecting' | 'error';
  error: ZellijErrorCode | null;
  configDirectory: string;
  configFile: string;
  configRevision: string;
  configExists: boolean;
  shortcuts: { splitDown: string; splitRight: string; closePane: string };
}

export interface ZellijApi {
  snapshot(params: { surfaceId: string }): Promise<ZellijSnapshot>;
  initialize(params: { surfaceId: string }): Promise<ZellijSnapshot>;
  saveShortcuts(params: {
    revision: string;
    shortcuts: ZellijSnapshot['shortcuts'];
  }): Promise<ZellijSnapshot>;
  copyConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }>;
  openConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }>;
  openSettings(): Promise<void>;
  consumeSettingsRequest(): Promise<boolean>;
  /** `surfaceId` says WHICH terminal measured; an unknown id is dropped, never guessed at. */
  setContentBounds(params: {
    surfaceId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<void>;
}

export interface ZellijWindowApi {
  openZellijWindow(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}
