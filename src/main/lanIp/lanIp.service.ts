// VENDORED FILE — bitterless is the source; micromeet-cowork only receives. See lanIp.helper.ts.
//
// The entire untested seam of this feature: the three real-world readers the pure cache takes as
// dependencies, plus one lazy invalidation. Everything with a decision in it lives in
// `lanIp.helper.ts` and is fixture-tested.
import { networkInterfaces } from 'node:os';
import { app, powerMonitor } from 'electron';
import { LanIpCache } from '@shared/lanIp/lanIp.helper';
import type { LanIpv4Snapshot } from '@shared/lanIp/lanIp.helper';

const lanIpCache = new LanIpCache({
  read: () => networkInterfaces(),
  platform: process.platform,
  now: () => Date.now()
});

let resumeInvalidationInstalled = false;

// Wake-on-a-different-network is the most common staleness path, so a resume marks the cached
// snapshot dirty and the NEXT read re-resolves. Deliberately a flag, never a broadcast: no channel,
// no subscribe/unsubscribe, no renderer change.
//
// `powerMonitor` needs a ready app and this module is reached from the xpc barrel during startup,
// so the listener is installed on first use rather than at module load.
//
// 'resume' is an incomplete signal by construction — it misses a Wi-Fi hop while the machine is
// awake, and it fires for sleeps with no network change at all. It is a convenience; the Refresh
// button remains the guarantee. See docs/features/workbench-lan-address.md.
const installResumeInvalidation = (): void => {
  if (resumeInvalidationInstalled || !app.isReady()) return;
  resumeInvalidationInstalled = true;
  powerMonitor.on('resume', () => lanIpCache.markStale());
};

export const readLanIpState = (): LanIpv4Snapshot => {
  installResumeInvalidation();
  return lanIpCache.state();
};

export const refreshLanIp = (): LanIpv4Snapshot => {
  installResumeInvalidation();
  return lanIpCache.refresh();
};
