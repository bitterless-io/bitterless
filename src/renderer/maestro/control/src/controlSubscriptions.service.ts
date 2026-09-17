import { xpcRenderer } from 'electron-xpc/renderer';

type Subscriber = Parameters<typeof xpcRenderer.subscribe>[1];
const relays = new Map<string, Set<Subscriber>>();

// Native subscriptions live for the renderer lifetime; authenticated mounts own removable listeners.
export class ControlSubscriptionScope {
  active = true;
  private removers: Array<() => void> = [];

  subscribe(channel: string, listener: Subscriber): void {
    if (!this.active) return;
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
    this.removers.push(() => current.delete(listener));
  }

  dispose(): void {
    this.active = false;
    for (const remove of this.removers) remove();
    this.removers = [];
  }
}
