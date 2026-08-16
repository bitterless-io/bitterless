export interface CoinSenderWebContents {
  isDestroyed(): boolean;
  readonly mainFrame: unknown;
}

export interface CoinSenderWindow {
  isDestroyed(): boolean;
  readonly webContents: CoinSenderWebContents;
}

export interface CoinInvokeEvent {
  readonly sender: unknown;
  readonly senderFrame: unknown;
}

export interface TrenchResourceSenderWebContents extends CoinSenderWebContents {
  getURL(): string;
}

export interface TrenchResourceInvokeEvent {
  readonly sender: TrenchResourceSenderWebContents;
  readonly senderFrame: unknown;
}

export const assertCoinIpcSender = (
  channel: string,
  event: CoinInvokeEvent,
  liveWindow: CoinSenderWindow | null,
): CoinSenderWindow => {
  const valid =
    !!liveWindow &&
    !liveWindow.isDestroyed() &&
    !liveWindow.webContents.isDestroyed() &&
    event.sender === liveWindow.webContents &&
    event.senderFrame === liveWindow.webContents.mainFrame;

  if (!valid) {
    throw new Error(`[coin ipc] rejected ${channel}: sender is not the live Coin window`);
  }
  return liveWindow;
};

export const assertTrenchResourceIpcSender = (
  channel: string,
  event: TrenchResourceInvokeEvent,
): TrenchResourceSenderWebContents => {
  let url: URL | null = null;
  try {
    url = new URL(event.sender.getURL());
  } catch {
    // Invalid URLs are rejected by the common invalid-sender branch below.
  }
  const localDevelopmentRenderer = Boolean(
    url &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      url.pathname === '/coin/index.html',
  );
  const builtRenderer = Boolean(
    url &&
      url.protocol === 'file:' &&
      /\/renderer\/coin\/index\.html$/.test(decodeURIComponent(url.pathname)),
  );
  const valid =
    !event.sender.isDestroyed() &&
    event.senderFrame === event.sender.mainFrame &&
    (localDevelopmentRenderer || builtRenderer);
  if (!valid) {
    throw new Error(`[coin ipc] rejected ${channel}: sender is not a live Trench main frame`);
  }
  return event.sender;
};
