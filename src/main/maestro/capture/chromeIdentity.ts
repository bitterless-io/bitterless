// A real-Chrome identity for the operation view, derived from the ACTUAL Chromium
// bundled in this Electron (process.versions.chrome) so the UA's Chrome major version
// always matches the real engine — a hardcoded/stale version is itself a tell.
//
// Applied two ways (see DebuggerCapture.attach + maestroWindow.helper):
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
}

export interface ChromeIdentity {
  userAgent: string
  acceptLanguage: string
  /** navigator.platform value (CDP `platform` param), distinct from the client-hint platform. */
  navigatorPlatform: string
  metadata: UserAgentMetadata
}

export function chromeIdentity(acceptLanguage = 'en-US,en;q=0.9'): ChromeIdentity {
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

  // GREASE "Not A Brand" entry — the exact token rotates across Chrome builds; sites
  // don't validate it, only that three brands are present.
  const brands: UserAgentBrand[] = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not=A?Brand', version: '24' }
  ]
  const fullVersionList: UserAgentBrand[] = [
    { brand: 'Chromium', version: fullVersion },
    { brand: 'Google Chrome', version: fullVersion },
    { brand: 'Not=A?Brand', version: '24.0.0.0' }
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
      platformVersion: isMac ? '15.0.0' : isWin ? '15.0.0' : '6.0.0',
      architecture: isArm ? 'arm' : 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false
    }
  }
}
