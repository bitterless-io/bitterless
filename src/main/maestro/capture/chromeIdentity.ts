// A real-Chrome identity for the operation view, derived from the ACTUAL Chromium
// bundled in this Electron (process.versions.chrome) so the UA's Chrome major version
// always matches the real engine — a hardcoded/stale version is itself a tell.
//
// Applied two ways (see DebuggerCapture.attach + CaptureService):
//   1. webContents.setUserAgent(userAgent)        — always-on UA header + navigator.userAgent
//   2. CDP Network.setUserAgentOverride(metadata) — Sec-CH-UA* client-hint headers
//                                                    + navigator.userAgentData (consistent)
// Electron's defaults leak "Electron/<v> <appName>/<v>" in the UA and an Electron
// brand in the client hints; this presents as plain Google Chrome instead.

export interface UserAgentBrand {
  brand: string
  version: string
}

export interface UserAgentMetadata {
  brands: UserAgentBrand[]
  fullVersionList: UserAgentBrand[]
  fullVersion: string
  platform: string
  platformVersion: string
  architecture: string
  model: string
  mobile: boolean
  bitness: string
  wow64: boolean
  /**
   * Backs Sec-CH-UA-Form-Factors / getHighEntropyValues().formFactors. Omitting it makes the JS
   * side report [] while the wire says "Desktop" — an inconsistency of our own making.
   */
  formFactors: string[]
}

/**
 * Chromium derives the GREASE ("Not A Brand") entry from the milestone, so it CHANGES every major.
 * Hardcoding it desyncs at the next Electron bump — e.g. `Not=A?Brand`/24 is Chrome 140's value and
 * is wrong for 144 or 150. Mirrors GenerateBrandVersionList in
 * components/embedder_support/user_agent_utils.cc.
 * Self-check: 140 -> Not=A?Brand/24 · 144 -> Not(A:Brand/8 · 150 -> Not;A=Brand/8 (all measured).
 */
function greaseBrand(major: number): UserAgentBrand {
  const chars = [' ', '(', ':', '-', '.', ' /', ')', ';', '=', '?', '_']
  const versions = ['8', '99', '24']
  return {
    brand: `Not${chars[major % chars.length]}A${chars[(major + 1) % chars.length]}Brand`,
    version: versions[major % versions.length]
  }
}

export interface ChromeIdentity {
  userAgent: string
  acceptLanguage: string
  /** navigator.platform value (CDP `platform` param), distinct from the client-hint platform. */
  navigatorPlatform: string
  metadata: UserAgentMetadata
}

/** Chrome sends the real OS version in Sec-CH-UA-Platform-Version; fall back only if unavailable. */
function systemVersion(): string {
  const raw = typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : ''
  if (raw) return raw
  return process.platform === 'linux' ? '6.0.0' : '15.0.0'
}

/**
 * @param acceptLanguage BARE, comma-separated language list — NOT pre-weighted. Chromium synthesises
 *   the q-values itself, for both `session.setUserAgent(ua, langs)` and CDP
 *   `Network.setUserAgentOverride`. Measured on Electron 40: passing 'en-US,en;q=0.9' puts
 *   `en-US,en;q=0.9;q=0.9` on the wire (malformed, and a louder tell than the value it replaces),
 *   while 'en-US,en' yields exactly Chrome's `en-US,en;q=0.9`.
 */
export function chromeIdentity(acceptLanguage = 'en-US,en'): ChromeIdentity {
  const fullVersion = process.versions.chrome || '140.0.0.0'
  const major = fullVersion.split('.')[0]
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'
  const isArm = process.arch === 'arm64' || process.arch === 'arm'

  const osToken = isMac
    ? 'Macintosh; Intel Mac OS X 10_15_7' // Chrome reports this fixed token on macOS regardless of CPU
    : isWin
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64'

  const userAgent = `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`

  // GREASE entry computed from the milestone, and listed FIRST — that is the order real Chrome
  // emits (measured: Chrome 150 sends `"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"`).
  const grease = greaseBrand(Number(major))
  const brands: UserAgentBrand[] = [
    grease,
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major }
  ]
  const fullVersionList: UserAgentBrand[] = [
    { brand: grease.brand, version: `${grease.version}.0.0.0` },
    { brand: 'Chromium', version: fullVersion },
    { brand: 'Google Chrome', version: fullVersion }
  ]

  return {
    userAgent,
    acceptLanguage,
    navigatorPlatform: isMac ? 'MacIntel' : isWin ? 'Win32' : 'Linux x86_64',
    metadata: {
      brands,
      fullVersionList,
      fullVersion,
      platform: isMac ? 'macOS' : isWin ? 'Windows' : 'Linux',
      // Real OS version rather than a constant — a machine on macOS 15.4.1 reporting 15.0.0 is a
      // gratuitous mismatch. process.getSystemVersion() is Electron-only, hence the guard.
      platformVersion: systemVersion(),
      architecture: isArm ? 'arm' : 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
      formFactors: ['Desktop']
    }
  }
}
