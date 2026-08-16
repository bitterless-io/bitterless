import { join } from 'path';
import { pathToFileURL } from 'url';

export interface SnipingSenderWebContents {
  readonly mainFrame: unknown;
  getURL(): string;
  isDestroyed(): boolean;
}

export interface SnipingInvokeEvent {
  readonly sender: SnipingSenderWebContents;
  readonly senderFrame: unknown;
}

export interface SnipingWindowLike {
  isDestroyed(): boolean;
  readonly webContents: SnipingSenderWebContents;
}

export interface SnipingRendererTargets {
  home: string;
  coin: string;
}

export const createSnipingRendererTargets = (
  appPath: string,
  rendererBaseUrl?: string,
): SnipingRendererTargets => {
  const target = (renderer: 'home' | 'coin'): string => rendererBaseUrl
    ? `${rendererBaseUrl.replace(/\/+$/, '')}/${renderer}/index.html`
    : pathToFileURL(join(appPath, 'out', 'renderer', renderer, 'index.html')).href;
  return { home: target('home'), coin: target('coin') };
};

export const createSnipingOmniTrenchTargets = (
  appPath: string,
  rendererBaseUrl?: string,
): string[] => {
  const roots = rendererBaseUrl
    ? [rendererBaseUrl.replace(/\/+$/, '')]
    : [pathToFileURL(join(appPath, 'out', 'renderer')).href.replace(/\/+$/, '')];
  return roots.map((root) => `${root}/coin/index.html`);
};

export const matchesSnipingRendererTarget = (raw: string, expected: string): boolean => {
  try {
    const actualUrl = new URL(raw);
    const expectedUrl = new URL(expected);
    actualUrl.hash = '';
    expectedUrl.hash = '';
    return actualUrl.href === expectedUrl.href;
  } catch {
    return false;
  }
};

export const assertSnipingHomeSender = (
  event: SnipingInvokeEvent,
  liveHome: SnipingWindowLike | null,
  expectedHomeUrl: string,
): void => {
  if (
    !liveHome || liveHome.isDestroyed() || liveHome.webContents.isDestroyed() ||
    event.sender !== liveHome.webContents || event.senderFrame !== liveHome.webContents.mainFrame ||
    !matchesSnipingRendererTarget(event.sender.getURL(), expectedHomeUrl)
  ) throw new Error('[sniping ipc] rejected non-Home session sender');
};

export const assertSnipingRendererSender = (
  event: SnipingInvokeEvent,
  liveStandalone: SnipingWindowLike | null,
  isLiveOmniTrench: (sender: SnipingSenderWebContents) => boolean,
  expectedCoinUrl: string,
  expectedOmniUrls: readonly string[] = [expectedCoinUrl],
): void => {
  const standalone = Boolean(
    liveStandalone && !liveStandalone.isDestroyed() && !liveStandalone.webContents.isDestroyed() &&
    event.sender === liveStandalone.webContents,
  );
  if (
    event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame ||
    (standalone
      ? !matchesSnipingRendererTarget(event.sender.getURL(), expectedCoinUrl)
      : !isLiveOmniTrench(event.sender) ||
        !expectedOmniUrls.some((target) => matchesSnipingRendererTarget(event.sender.getURL(), target)))
  ) throw new Error('[sniping ipc] rejected non-live Trench sender');
};
