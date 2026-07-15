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
