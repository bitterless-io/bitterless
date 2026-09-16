// LAN IPv4 resolution — VENDORED FILE. bitterless is the source; micromeet-cowork only receives.
//
// Copy this file byte-for-byte into `micromeet-cowork/apps/cowork/src/shared/lanIp/lanIp.helper.ts`
// after every edit, and verify with `yarn workspace @micromeet/cowork check:lan-ip-vendor`. That
// guard exits 0 where the bitterless checkout is absent, so it only ever fires on Ral's machine —
// run it deliberately. Drift here is silent and dangerous: a deny-list entry added on one side only
// makes the two apps disagree about which address is "your LAN IP" on the same machine, with no
// error anywhere. Same direction rule as `apps/cowork/scripts/sync-onlypreview-native-labels.mjs`.
//
// Two properties make this file vendorable at all. Preserve both if you ever edit it.
//
//   1. ZERO IMPORTS. The interface table is described structurally instead of importing
//      `os.NetworkInterfaceInfo`. The moment this file imports anything — even `import type` from
//      `node:os` — it becomes tsconfig-dependent and stops being portable to a third surface.
//
//   2. ALL I/O INJECTED. `pickLanIpv4` takes the interface table as a PARAMETER, and `LanIpCache`
//      takes `read` / `platform` / `now` as constructor dependencies. This is not a testing
//      convenience: it shrinks the untested seam of the whole feature down to the few lines of
//      `src/main/lanIp/lanIp.service.ts`, and it is what lets cowork's `vm` loader and bitterless's
//      esbuild bundle run the SAME fixture table with no `node:os` stubbing. A stubbed reader would
//      otherwise assert against whatever network the machine happens to be on and go red on the
//      next one. Do not "simplify" the reader back inside.
//
// Design record: `docs/features/workbench-lan-address.md`.

/** One `os.networkInterfaces()` entry, described structurally so this file imports nothing. */
export interface LanIpInterfaceInfo {
  address?: string;
  netmask?: string;
  family?: string | number;
  internal?: boolean;
  cidr?: string | null;
}

/**
 * Structurally assignable from `ReturnType<typeof os.networkInterfaces>`, so Main hands the real
 * table straight in with no cast. Every field is optional, which makes a malformed entry a data
 * case rather than a type error — this shape crosses xpc, and a throw would blank the pane.
 */
export type LanIpInterfaceTable = Record<string, LanIpInterfaceInfo[] | undefined>;

export interface LanIpv4Candidate {
  address: string;
  interfaceName: string;
  virtual: boolean;
}

export type LanIpv4Pick =
  | { status: 'ok'; address: string; interfaceName: string; others: LanIpv4Candidate[] }
  | { status: 'none'; others: LanIpv4Candidate[] };

/**
 * What crosses the wire. `status: 'error'` deliberately carries NO message: Main logs the
 * exception, the UI renders a translated string. That structurally forecloses an untranslated
 * exception appearing in the settings pane.
 */
export type LanIpv4Snapshot =
  | { status: 'ok'; address: string; interfaceName: string; others: LanIpv4Candidate[]; resolvedAt: number }
  | { status: 'none'; others: LanIpv4Candidate[]; resolvedAt: number }
  | { status: 'error'; others: LanIpv4Candidate[]; resolvedAt: number };

interface Ipv4Range {
  base: number;
  mask: number;
}

const cidrRange = (a: number, b: number, c: number, d: number, prefix: number): Ipv4Range => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: ((((a << 24) | (b << 16) | (c << 8) | d) >>> 0) & mask) >>> 0, mask };
};

/**
 * Dropped unconditionally, by ADDRESS, whatever the interface is called. A name-based rule cannot
 * cover these: Clash/Xray hands `198.18.x.x` to an interface whose name differs per platform.
 */
const DENIED_RANGES: Ipv4Range[] = [
  cidrRange(127, 0, 0, 0, 8), // loopback
  cidrRange(0, 0, 0, 0, 8), // "this network"
  cidrRange(169, 254, 0, 0, 16), // APIPA — DHCP failed, never a usable LAN
  cidrRange(198, 18, 0, 0, 15), // RFC 2544 benchmark — Clash / Xray TUN
  cidrRange(192, 0, 2, 0, 24), // TEST-NET-1
  cidrRange(198, 51, 100, 0, 24), // TEST-NET-2
  cidrRange(203, 0, 113, 0, 24), // TEST-NET-3
  cidrRange(224, 0, 0, 0, 4), // multicast
  cidrRange(240, 0, 0, 0, 4) // reserved, covers 255.255.255.255
];

// Ranked, NOT required: a public-IPv4 LAN is rare but real, and some CPE hands out CGNAT.
const RFC1918_RANGES: Ipv4Range[] = [
  cidrRange(10, 0, 0, 0, 8),
  cidrRange(172, 16, 0, 0, 12),
  cidrRange(192, 168, 0, 0, 16)
];

const CGNAT_RANGE = cidrRange(100, 64, 0, 0, 10);

/**
 * Windows interface keys are the user-renamable, LOCALIZED Connection name, so an allow-list is
 * structurally wrong here and matching is by lowercase substring.
 */
const WINDOWS_VIRTUAL_NAME_PARTS = [
  'loopback',
  'vethernet',
  'wsl',
  'hyper-v',
  'virtual adapter',
  'virtual ethernet',
  'vmware',
  'vmnet',
  'virtualbox',
  'docker',
  'tap-',
  'wintun',
  'tun',
  'openvpn',
  'wireguard',
  'tailscale',
  'zerotier',
  'nordvpn',
  'expressvpn',
  'proton',
  'clash',
  'mihomo',
  'bluetooth',
  'local area connection*',
  'teredo',
  'isatap',
  '6to4',
  'pseudo'
];

/**
 * darwin/linux names are stable device names, so matching is by PREFIX. `en*` is allowed in full:
 * `en0` is Wi-Fi, `en1`–`en6` only carry an IPv4 when something real is plugged in, and a
 * USB-tethered iPhone is `en*` with `172.20.10.x` and is a legitimate LAN.
 */
const POSIX_VIRTUAL_NAME_PREFIXES = [
  'utun',
  'ipsec',
  'ppp',
  'awdl',
  'llw',
  'anpi',
  'bridge',
  'vmnet',
  'vboxnet',
  'vnic',
  'gif',
  'stf',
  'docker',
  'veth',
  'br-',
  'lo'
];

/**
 * `ap1` is the Wi-Fi hotspot interface and carries `192.168.2.1` under Internet Sharing. Matched
 * exactly rather than by prefix, because `startsWith('ap')` would swallow a renamed real NIC.
 */
const POSIX_HOTSPOT_PATTERN = /^ap\d+$/;

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Sorts after every real prefix, so an unknown prefix never wins a tie by accident. */
const UNKNOWN_PREFIX = 33;

const toOctets = (address: string): number[] | null => {
  if (!IPV4_PATTERN.test(address)) return null;
  const octets: number[] = [];
  for (const part of address.split('.')) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets;
};

const toUint32 = (octets: number[]): number =>
  (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);

const inRange = (value: number, range: Ipv4Range): boolean => ((value & range.mask) >>> 0) === range.base;

const inAnyRange = (value: number, ranges: Ipv4Range[]): boolean => {
  for (const range of ranges) {
    if (inRange(value, range)) return true;
  }
  return false;
};

const countBits = (octet: number): number => {
  let bits = 0;
  for (let value = octet; value > 0; value >>= 1) bits += value & 1;
  return bits;
};

const readPrefixLength = (info: LanIpInterfaceInfo): number | null => {
  const cidr = typeof info.cidr === 'string' ? info.cidr : '';
  const slash = cidr.lastIndexOf('/');
  if (slash >= 0) {
    const parsed = Number(cidr.slice(slash + 1));
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 32) return parsed;
  }

  const netmask = typeof info.netmask === 'string' ? toOctets(info.netmask) : null;
  if (netmask) {
    let bits = 0;
    for (const octet of netmask) bits += countBits(octet);
    return bits;
  }

  return null;
};

export const isVirtualInterface = (name: string, platform: string): boolean => {
  const lowered = name.toLowerCase();

  if (platform === 'win32') {
    for (const part of WINDOWS_VIRTUAL_NAME_PARTS) {
      if (lowered.includes(part)) return true;
    }
    return false;
  }

  for (const prefix of POSIX_VIRTUAL_NAME_PREFIXES) {
    if (lowered.startsWith(prefix)) return true;
  }
  return POSIX_HOTSPOT_PATTERN.test(lowered);
};

interface RankedCandidate extends LanIpv4Candidate {
  score: number;
  prefix: number;
}

const addressScore = (value: number): number => {
  if (inAnyRange(value, RFC1918_RANGES)) return 30;
  if (inRange(value, CGNAT_RANGE)) return 10;
  return 20;
};

/**
 * `os.networkInterfaces()` key order is OS insertion order and is not contractually stable, so a
 * TOTAL order is mandatory rather than polish: without it, equal scores let a re-resolve flip the
 * shown address and Refresh becomes a slot machine.
 */
const compareCandidates = (a: RankedCandidate, b: RankedCandidate): number => {
  if (a.score !== b.score) return b.score - a.score;
  if (a.prefix !== b.prefix) return a.prefix - b.prefix;
  const byName = a.interfaceName.localeCompare(b.interfaceName, undefined, { numeric: true });
  if (byName !== 0) return byName;
  return a.address.localeCompare(b.address);
};

const toCandidate = (ranked: RankedCandidate): LanIpv4Candidate => ({
  address: ranked.address,
  interfaceName: ranked.interfaceName,
  virtual: ranked.virtual
});

export const pickLanIpv4 = (interfaces: LanIpInterfaceTable, platform: string): LanIpv4Pick => {
  const ranked: RankedCandidate[] = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    if (!Array.isArray(entries)) continue;

    for (const info of entries) {
      if (!info || typeof info !== 'object') continue;
      // `|| 4` is one token of insurance. Electron 40.x reports the string 'IPv4', but the numeric
      // form survives a Node downgrade and lets one fixture exercise it.
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      if (info.internal === true) continue;

      const address = typeof info.address === 'string' ? info.address : '';
      const octets = toOctets(address);
      if (!octets) continue;

      const value = toUint32(octets);
      if (inAnyRange(value, DENIED_RANGES)) continue;

      const virtual = isVirtualInterface(interfaceName, platform);
      const prefix = readPrefixLength(info);
      // A /30, /31 or /32 is a point-to-point link, not a LAN, so it earns no bonus.
      const prefixScore = prefix !== null && prefix >= 8 && prefix <= 24 ? 5 : 0;

      ranked.push({
        address,
        interfaceName,
        virtual,
        prefix: prefix === null ? UNKNOWN_PREFIX : prefix,
        score: (virtual ? 0 : 100) + addressScore(value) + prefixScore
      });
    }
  }

  ranked.sort(compareCandidates);

  // A deny-listed interface can NEVER become the primary, even as the only candidate. Showing
  // 192.168.56.1 (VirtualBox) as "your LAN IP" is silently wrong; "no address" is recoverable.
  const primary = ranked.find((candidate) => !candidate.virtual);
  if (!primary) return { status: 'none', others: ranked.map(toCandidate) };

  return {
    status: 'ok',
    address: primary.address,
    interfaceName: primary.interfaceName,
    others: ranked.filter((candidate) => candidate !== primary).map(toCandidate)
  };
};

export interface LanIpCacheDeps {
  read: () => LanIpInterfaceTable;
  platform: string;
  now: () => number;
}

/**
 * Resolve-once cache. Resolution is SYNCHRONOUS (`os.networkInterfaces()` is), so there is no
 * in-flight promise and no Main-side race to dedupe — do not reintroduce the `loadPromise` idiom
 * from `generalSetting.store.ts`, which exists only because that loader is async all the way down.
 */
export class LanIpCache {
  private snapshot: LanIpv4Snapshot | null = null;
  private readonly deps: LanIpCacheDeps;

  // Written as a plain field assignment, NOT a TypeScript parameter property
  // (`constructor(private readonly deps: …)`). Node's type stripping rejects parameter properties,
  // enums and namespaces, so a parameter property would break the moment a test imports this file
  // as `.ts` directly instead of bundling it — and it would read as a broken test rather than as a
  // style violation.
  constructor(deps: LanIpCacheDeps) {
    this.deps = deps;
  }

  /** Cached for the app's lifetime. The interface table is not read again until an invalidation. */
  state(): LanIpv4Snapshot {
    return this.snapshot ?? this.resolveNow();
  }

  /** Clears the cache and re-resolves, unconditionally. The user-facing recovery path. */
  refresh(): LanIpv4Snapshot {
    this.snapshot = null;
    return this.resolveNow();
  }

  /** Lazy invalidation: the NEXT read re-resolves. Never a push, so no channel and no subscribers. */
  markStale(): void {
    this.snapshot = null;
  }

  private resolveNow(): LanIpv4Snapshot {
    const resolvedAt = this.deps.now();

    try {
      const pick = pickLanIpv4(this.deps.read(), this.deps.platform);
      const snapshot: LanIpv4Snapshot =
        pick.status === 'ok'
          ? {
              status: 'ok',
              address: pick.address,
              interfaceName: pick.interfaceName,
              others: pick.others,
              resolvedAt
            }
          : { status: 'none', others: pick.others, resolvedAt };

      // 'none' IS cached: going offline is exactly what the Refresh button is for.
      this.snapshot = snapshot;
      return snapshot;
    } catch (err) {
      // 'error' is deliberately NOT cached. With button-only invalidation, caching a transient
      // throw at boot would pin a broken state for the whole app lifetime. A failed read is not an
      // answer; the next read retries, which costs a sub-millisecond re-read only while broken.
      console.error('[LanIpCache] Could not read network interfaces:', err);
      return { status: 'error', others: [], resolvedAt };
    }
  }
}
