// VENDORED FILE — bitterless is the source; micromeet-cowork only receives. Copy byte-for-byte to
// `micromeet-cowork/apps/cowork/tests/unit/lanIp.cases.mjs`. One fixture table drives both repos'
// test runners, which is the only way the two apps can be proven to agree about which address is
// "your LAN IP" on the same machine. See src/shared/lanIp/lanIp.helper.ts for the direction rule.
//
// Asserted against FIXTURES, never by grepping the source for a deny-list entry: a grep proves the
// list exists, not that it is correct.

const prefixToNetmask = (prefix) => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [(mask >>> 24) & 0xff, (mask >>> 16) & 0xff, (mask >>> 8) & 0xff, mask & 0xff].join('.');
};

const ipv4 = (address, prefix, extra = {}) => ({
  address,
  netmask: prefixToNetmask(prefix),
  family: 'IPv4',
  internal: false,
  cidr: `${address}/${prefix}`,
  ...extra
});

const candidate = (address, interfaceName, virtual) => ({ address, interfaceName, virtual });

/** This machine, verbatim: Wi-Fi up, Clash/Xray TUN up, loopback. */
export const RAL_MACHINE_INTERFACES = {
  lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true, cidr: '127.0.0.1/8' }],
  en0: [ipv4('192.168.2.45', 22)],
  utun1024: [ipv4('198.18.0.1', 30)]
};

/** Same machine with Wi-Fi switched off. The Clash tunnel is still up. */
export const RAL_MACHINE_WIFI_OFF = {
  lo0: RAL_MACHINE_INTERFACES.lo0,
  utun1024: RAL_MACHINE_INTERFACES.utun1024
};

export const pickCases = [
  {
    name: 'this machine: Wi-Fi wins and the Clash tunnel is dropped outright, not merely out-ranked',
    platform: 'darwin',
    interfaces: RAL_MACHINE_INTERFACES,
    expected: { status: 'ok', address: '192.168.2.45', interfaceName: 'en0', others: [] }
  },
  {
    // NON-NEGOTIABLE. Case 1 alone cannot catch a missing 198.18.0.0/15 rule, because `en0`
    // currently enumerates before `utun1024` and "first match wins" returns the right answer by
    // luck. Without this case a broken deny-list ships green and only surfaces the first time Ral
    // turns Wi-Fi off. If the suite ever gets trimmed, trim anything else first.
    name: 'Wi-Fi off with the tunnel up reports no address, never 198.18.0.1',
    platform: 'darwin',
    interfaces: RAL_MACHINE_WIFI_OFF,
    expected: { status: 'none', others: [] }
  },
  {
    name: 'a benchmark-range address is dropped on Windows even under an innocuous adapter name',
    platform: 'win32',
    interfaces: { 'Ethernet 3': [ipv4('198.18.0.1', 30)] },
    expected: { status: 'none', others: [] }
  },
  {
    name: 'WSL loses to Wi-Fi although both are RFC1918 — the name rule decides',
    platform: 'win32',
    interfaces: {
      'vEthernet (WSL)': [ipv4('172.28.16.1', 20)],
      'Wi-Fi': [ipv4('192.168.1.20', 24)]
    },
    expected: {
      status: 'ok',
      address: '192.168.1.20',
      interfaceName: 'Wi-Fi',
      others: [candidate('172.28.16.1', 'vEthernet (WSL)', true)]
    }
  },
  {
    name: 'a WSL adapter alone is never a fallback',
    platform: 'win32',
    interfaces: { 'vEthernet (WSL)': [ipv4('172.28.16.1', 20)] },
    expected: { status: 'none', others: [candidate('172.28.16.1', 'vEthernet (WSL)', true)] }
  },
  {
    name: 'a localized Windows adapter name is admitted — there is no English allow-list',
    platform: 'win32',
    interfaces: { '以太网': [ipv4('192.168.1.20', 24)] },
    expected: { status: 'ok', address: '192.168.1.20', interfaceName: '以太网', others: [] }
  },
  {
    name: 'virtual adapters enumerated before the real NIC still lose',
    platform: 'darwin',
    interfaces: {
      utun0: [ipv4('10.8.0.6', 24)],
      bridge0: [ipv4('192.168.64.1', 24)],
      en0: [ipv4('192.168.2.45', 22)]
    },
    expected: {
      status: 'ok',
      address: '192.168.2.45',
      interfaceName: 'en0',
      others: [candidate('192.168.64.1', 'bridge0', true), candidate('10.8.0.6', 'utun0', true)]
    }
  },
  {
    name: 'the numeric family form is admitted as well as the string one',
    platform: 'darwin',
    interfaces: {
      en0: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 4, internal: false, cidr: '192.168.1.20/24' }]
    },
    expected: { status: 'ok', address: '192.168.1.20', interfaceName: 'en0', others: [] }
  },
  {
    name: 'an IPv6-only machine reports no address',
    platform: 'darwin',
    interfaces: { en0: [{ address: 'fe80::1', family: 'IPv6', internal: false, cidr: 'fe80::1/64' }] },
    expected: { status: 'none', others: [] }
  },
  {
    name: 'link-local 169.254.x only means DHCP failed, not a LAN',
    platform: 'darwin',
    interfaces: { en0: [ipv4('169.254.31.7', 16)] },
    expected: { status: 'none', others: [] }
  },
  {
    name: 'loopback is dropped by address even when it claims internal: false',
    platform: 'darwin',
    interfaces: { lo0: [ipv4('127.0.0.1', 8)] },
    expected: { status: 'none', others: [] }
  },
  {
    name: 'internal: true on an RFC1918 address is dropped',
    platform: 'darwin',
    interfaces: { en0: [ipv4('192.168.1.20', 24, { internal: true })] },
    expected: { status: 'none', others: [] }
  },
  {
    name: 'dual-homed: the shorter prefix wins and the runner-up is disclosed',
    platform: 'darwin',
    interfaces: { en0: [ipv4('192.168.2.45', 22)], en6: [ipv4('192.168.5.10', 24)] },
    expected: {
      status: 'ok',
      address: '192.168.2.45',
      interfaceName: 'en0',
      others: [candidate('192.168.5.10', 'en6', false)]
    },
    // The only proof that the total order is real rather than an artifact of enumeration order.
    alsoReversedKeyOrder: true
  },
  {
    name: 'a /30 point-to-point link loses the prefix bonus and the LAN wins',
    platform: 'darwin',
    interfaces: { en5: [ipv4('10.0.0.2', 30)], en0: [ipv4('192.168.2.45', 22)] },
    expected: {
      status: 'ok',
      address: '192.168.2.45',
      interfaceName: 'en0',
      others: [candidate('10.0.0.2', 'en5', false)]
    }
  },
  {
    name: 'CGNAT alone is a usable answer',
    platform: 'darwin',
    interfaces: { en0: [ipv4('100.72.3.4', 10)] },
    expected: { status: 'ok', address: '100.72.3.4', interfaceName: 'en0', others: [] }
  },
  {
    name: 'CGNAT loses to an RFC1918 sibling',
    platform: 'darwin',
    interfaces: { en0: [ipv4('100.72.3.4', 10)], en1: [ipv4('192.168.1.5', 24)] },
    expected: {
      status: 'ok',
      address: '192.168.1.5',
      interfaceName: 'en1',
      others: [candidate('100.72.3.4', 'en0', false)]
    }
  },
  {
    name: 'a public-IPv4 LAN is allowed',
    platform: 'darwin',
    interfaces: { en0: [ipv4('203.0.55.7', 24)] },
    expected: { status: 'ok', address: '203.0.55.7', interfaceName: 'en0', others: [] }
  },
  {
    name: 'TEST-NET-3 is not a LAN even though it neighbours a real public range',
    platform: 'darwin',
    interfaces: { en0: [ipv4('203.0.113.7', 24)] },
    expected: { status: 'none', others: [] }
  },
  {
    // The virtual rule proven both ways: never promoted, always disclosed.
    name: 'a VirtualBox/VMware host address is never promoted, but it is disclosed',
    platform: 'darwin',
    interfaces: { vmnet8: [ipv4('192.168.56.1', 24)] },
    expected: { status: 'none', others: [candidate('192.168.56.1', 'vmnet8', true)] }
  },
  {
    name: 'an empty interface table reports no address',
    platform: 'darwin',
    interfaces: {},
    expected: { status: 'none', others: [] }
  },
  {
    // This shape crosses xpc. A throw here blanks the settings pane.
    name: 'malformed entries are dropped as data, never thrown on',
    platform: 'darwin',
    interfaces: {
      en0: [
        { address: '', family: 'IPv4', internal: false },
        { address: '192.168.1', family: 'IPv4', internal: false },
        { address: '999.1.1.1', family: 'IPv4', internal: false },
        null,
        { family: 'IPv4', internal: false }
      ],
      en1: undefined,
      en2: 'not-an-array'
    },
    expected: { status: 'none', others: [] }
  },
  {
    name: 'the macOS bridge interface loses to the Wi-Fi NIC on the same subnet',
    platform: 'darwin',
    interfaces: { bridge0: [ipv4('192.168.2.1', 24)], en0: [ipv4('192.168.2.45', 22)] },
    expected: {
      status: 'ok',
      address: '192.168.2.45',
      interfaceName: 'en0',
      others: [candidate('192.168.2.1', 'bridge0', true)]
    }
  },
  {
    name: 'the Wi-Fi hotspot interface ap1 is virtual, but a renamed NIC starting with "ap" is not',
    platform: 'darwin',
    interfaces: { ap1: [ipv4('192.168.2.1', 24)], apex0: [ipv4('192.168.9.20', 24)] },
    expected: {
      status: 'ok',
      address: '192.168.9.20',
      interfaceName: 'apex0',
      others: [candidate('192.168.2.1', 'ap1', true)]
    }
  }
];
