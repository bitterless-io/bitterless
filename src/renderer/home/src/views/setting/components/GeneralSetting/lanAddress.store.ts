import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { LanIpApi, LanIpv4Candidate, LanIpv4Snapshot } from '@shared/lanIp/lanIp.api';

// The `as LanIpApi` cast is load-bearing, not decoration. `XpcEmitterOf<T>` erases the return type
// of every ZERO-ARG method to `() => Promise<any>`, and both methods on this contract are zero-arg —
// uncast, every field-name check in the template is silently lost with no compile error.
const lanIpEmitter = createXpcRendererEmitter<LanIpApi>('LanIpHandler') as LanIpApi;

/**
 * Deliberately a SEPARATE store from `generalSetting.store.ts`, and never chained into its
 * `loadSettings()`: that method awaits emitters targeting preload handlers the workbench preload
 * never registers, so it already rejects on exactly the surface this feature targets. Chaining the
 * LAN load into it would make the address silently fail to load in the workbench.
 *
 * Resolution is synchronous in Main, so a single `loaded` boolean plus the `busy` re-entrancy flag
 * is enough. `busy` is set SYNCHRONOUSLY inside `run()` — before its first `await` — so a fast
 * open/close/open cannot fire two resolves even though `loaded` is now settled after the read
 * rather than before it. There is no in-flight promise to dedupe here; do not add one back.
 */
class LanAddressState {
  snapshot: LanIpv4Snapshot | null = null;
  busy = false;
  stale = false;
  private loaded = false;
  private queued = false;

  /** `null` until the first response lands — the template must not render a "no address" line yet. */
  get status(): LanIpv4Snapshot['status'] | null {
    return this.snapshot ? this.snapshot.status : null;
  }

  get address(): string {
    return this.snapshot && this.snapshot.status === 'ok' ? this.snapshot.address : '';
  }

  /** The whole diagnostic affordance of the `ok` state. Do not drop it as noise. */
  get interfaceName(): string {
    return this.snapshot && this.snapshot.status === 'ok' ? this.snapshot.interfaceName : '';
  }

  get ignored(): LanIpv4Candidate[] {
    return this.snapshot ? this.snapshot.others : [];
  }

  async load(): Promise<void> {
    if (this.loaded || this.busy) return;
    await this.run(() => lanIpEmitter.state());
  }

  async refresh(): Promise<void> {
    // A refresh asked for while a read is in flight is QUEUED, never dropped: the in-flight read
    // may have started BEFORE the network change that triggered this one, so its answer can
    // already be stale. Dropping it is how the `'online'` self-heal below silently fails and
    // leaves the "network changed" hint on screen for good.
    if (this.busy) {
      this.queued = true;
      return;
    }
    await this.run(() => lanIpEmitter.refresh());
  }

  markStale(): void {
    this.stale = true;
  }

  private async run(call: () => Promise<LanIpv4Snapshot>): Promise<void> {
    let next: (() => Promise<LanIpv4Snapshot>) | null = call;

    while (next) {
      this.busy = true;
      try {
        this.snapshot = await next();
        this.stale = false;
      } catch (err) {
        // The raw exception never reaches the pane: the UI renders a translated string.
        console.error('[LanAddressState] Failed to read the LAN address:', err);
        this.snapshot = { status: 'error', others: [], resolvedAt: Date.now() };
      } finally {
        this.busy = false;
      }

      // An ERROR does not consume the resolve-once budget. `ok` and `none` are answers and are
      // never re-read without Refresh; a failed read is not an answer. Without this line Main's
      // deliberate "error is not cached" policy is unreachable from the UI — the renderer would
      // pin the very first failure and every later panel open would short-circuit before the xpc
      // call, leaving "Could not read network interfaces" on screen for the app's whole lifetime.
      this.loaded = this.snapshot !== null && this.snapshot.status !== 'error';

      // Queued requests collapse into exactly one follow-up, so a flapping link cannot build a
      // backlog. `busy` never observably drops between iterations: nothing awaits in between.
      next = this.queued ? () => lanIpEmitter.refresh() : null;
      this.queued = false;
    }
  }
}

export const lanAddressStore = reactive(new LanAddressState());

// Installed ONCE at module scope, never per-mount and never removed — the store is a module
// singleton, so a listener added on mount would be added again on every remount of the pane.
//
// This self-heals the machine that boots with no network, which would otherwise sit at "no local
// network address" for the app's entire life. It is a convenience, not a guarantee: an SSID hop
// that never drops to fully offline fires no event at all, which is why Refresh stays the
// documented recovery path. When a transition was seen but the re-resolve has not landed, the row
// shows its "network changed" hint.
//
// `navigator.onLine` is used ONLY as an event trigger, never read as a VALUE: in Electron it reads
// `true` with nothing but a tunnel up. The address always comes from a real resolve.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    lanAddressStore.markStale();
    void lanAddressStore.refresh();
  });
}
