import { xpcRenderer } from 'electron-xpc/renderer';

type Subscriber = Parameters<typeof xpcRenderer.subscribe>[1];
const relays = new Map<string, Set<Subscriber>>();

/**
 * One native `xpcRenderer.subscribe` per channel, fanned out to a Set.
 *
 * This indirection is not optional bookkeeping — electron-xpc's `subscribe()` is
 * `xpcSubscribers.set(handleName, callback)`, so a SECOND bare subscribe to the same channel in the
 * same renderer silently and permanently replaces the first, with no error and nothing visible on the
 * main side (it dedupes by webContentsId, so it sees one subscriber either way).
 * See docs/issues/xpc-subscribe-silently-overwrites.md.
 */
const attach = (channel: string, listener: Subscriber): (() => void) => {
  let listeners = relays.get(channel);
  if (!listeners) {
    listeners = new Set();
    relays.set(channel, listeners);
    xpcRenderer.subscribe(channel, (payload) => {
      for (const callback of relays.get(channel) || []) callback(payload);
    });
  }
  listeners.add(listener);
  const current = listeners;
  return () => current.delete(listener);
};

/**
 * Renderer-lifetime fan-out: shares the single native subscription above, without a disposer.
 * For stores that subscribe once behind their own `subscribed` guard and never tear down —
 * they must still go through the relay, or they take the channel away from everyone else.
 */
export const subscribeControlChannel = (channel: string, listener: Subscriber): void => {
  attach(channel, listener);
};

// Native subscriptions live for the renderer lifetime; authenticated mounts own removable listeners.
export class ControlSubscriptionScope {
  active = true;
  private removers: Array<() => void> = [];

  subscribe(channel: string, listener: Subscriber): void {
    if (!this.active) return;
    this.removers.push(attach(channel, listener));
  }

  dispose(): void {
    this.active = false;
    for (const remove of this.removers) remove();
    this.removers = [];
  }
}
