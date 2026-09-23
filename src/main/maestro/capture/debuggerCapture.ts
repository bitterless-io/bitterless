import type { WebContents } from 'electron'
import { stringify as stringifyYaml } from 'yaml'
import type { HeaderMap, NetworkTiming, ResponseBodyOmittedReason, TraceEvent, UiActionStep, UiActionTarget } from '@maestro-shared/trace.types'
import { chromeIdentity } from './chromeIdentity'
import {
  base64DecodedLength,
  classifyResponseBodyCapture,
  isProbablyBinaryBuffer,
  isStreamingResponseMime,
  normalizeResponseMime
} from './responseBodyPolicy'
import {
  findMatchingInterceptionRule,
  fetchHeaderEntriesToMap,
  hasHeader,
  headerEntriesForFetch,
  interceptionRuleSummary,
  interceptionStagesForRules,
  mergeHeaders,
  type NetworkInterceptionRule
} from './networkInterception'

// Injected into every page (and the current one) to capture user actions.
// Calls window.__coachRecord(...), bridged to main via Runtime.addBinding ->
// Runtime.bindingCalled — no preload into the target page, no open port.
const INJECT = `
(() => {
  if (window.__coachHooked) return; window.__coachHooked = true;
  const clean = (v, max = 140) => String(v || '').replace(/\\s+/g, ' ').trim().slice(0, max);
  const css = (v) => (window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\\\]/g, '\\\\$&'));
  const unique = (selector) => {
    try { return document.querySelectorAll(selector).length === 1; } catch (_) { return false; }
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button' || type === 'button' || type === 'submit') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    if (/h[1-6]/.test(tag)) return 'heading';
    return undefined;
  };
  const labelOf = (el) => {
    const aria = clean(el.getAttribute && el.getAttribute('aria-label'));
    if (aria) return aria;
    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      const cleaned = clean(text);
      if (cleaned) return cleaned;
    }
    if (el.id) {
      const label = document.querySelector('label[for="' + css(el.id) + '"]');
      const text = clean(label && label.textContent);
      if (text) return text;
    }
    const wrapping = el.closest && el.closest('label');
    const wrapped = clean(wrapping && wrapping.textContent);
    if (wrapped) return wrapped;
    const placeholder = clean(el.getAttribute && el.getAttribute('placeholder'));
    if (placeholder) return placeholder;
    return clean(el.textContent, 80);
  };
  const nthOfType = (el) => {
    let i = 1;
    let p = el;
    while ((p = p.previousElementSibling)) {
      if (p.tagName === el.tagName) i += 1;
    }
    return i;
  };
  const pathSelector = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
      const tag = (node.tagName || '').toLowerCase();
      if (!tag) break;
      const id = node.id ? '#' + css(node.id) : '';
      if (id) {
        parts.unshift(tag + id);
        break;
      }
      parts.unshift(tag + ':nth-of-type(' + nthOfType(node) + ')');
      node = node.parentElement;
    }
    return parts.length ? parts.join(' > ') : '';
  };
  const selectorsFor = (el) => {
    const tag = (el.tagName || '').toLowerCase();
    const selectors = [];
    const testid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test'));
    if (testid) selectors.push('[data-testid="' + css(testid) + '"]');
    if (el.id) selectors.push('#' + css(el.id));
    const name = el.getAttribute && el.getAttribute('name');
    if (name) selectors.push(tag + '[name="' + css(name) + '"]');
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) selectors.push(tag + '[aria-label="' + css(aria) + '"]');
    const placeholder = el.getAttribute && el.getAttribute('placeholder');
    if (placeholder) selectors.push(tag + '[placeholder="' + css(placeholder) + '"]');
    const path = pathSelector(el);
    if (path) selectors.push(path);
    const deduped = Array.from(new Set(selectors.filter(Boolean)));
    const best = deduped.find(unique) || deduped[0] || tag;
    return { best, selectors: deduped.length ? deduped : [best] };
  };
  const targetOf = (el) => {
    const selected = selectorsFor(el);
    const text = clean(el.innerText || el.textContent, 100);
    return {
      tag: (el.tagName || '').toLowerCase(),
      selector: selected.best,
      selectors: selected.selectors,
      role: roleOf(el),
      name: clean(el.getAttribute && el.getAttribute('name')),
      label: labelOf(el),
      text,
      placeholder: clean(el.getAttribute && el.getAttribute('placeholder')),
      inputType: clean(el.getAttribute && el.getAttribute('type'))
    };
  };
  const valueOf = (el) => {
    const type = ((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
    if (type === 'password') return '[password omitted]';
    if (type === 'file') return '[file omitted]';
    if ('value' in el) return String(el.value || '');
    return '';
  };
  const isFormControl = (el) => {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'select' || tag === 'textarea') return true;
    if (tag === 'input') {
      const t = ((el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase();
      return t !== 'button' && t !== 'submit' && t !== 'reset' && t !== 'image';
    }
    return !!el.isContentEditable;
  };
  // Decide whether a click is worth recording. Page JS can't read addEventListener-attached
  // click handlers (and SPA frameworks delegate to the document root, so even devtools'
  // getEventListeners on the clicked node shows nothing), so we approximate "is this
  // clickable" with robust signals: a real interactive tag/role/attribute, OR cursor:pointer
  // (the standard convention for clickable <div>s; cursor is inherited, so a click on text
  // inside a clickable card still reads 'pointer'). Plain layout <div>s keep the default
  // cursor and are skipped. Returns the actionable element to record against, or null.
  const INTERACTIVE_SEL =
    'a[href],button,summary,[role=button],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=option],[role=switch],[role=checkbox],[role=radio],[onclick],[tabindex]:not([tabindex="-1"])';
  const clickableByStyle = (el) => {
    try { return getComputedStyle(el).cursor === 'pointer'; } catch (_) { return false; }
  };
  const actionableTarget = (el) => {
    const byAttr = el.closest && el.closest(INTERACTIVE_SEL);
    if (byAttr) return byAttr;
    if (!clickableByStyle(el)) return null;
    // cursor:pointer is inherited — climb to the OUTERMOST element still showing pointer,
    // which is normally the element that actually declares the clickable behaviour.
    let node = el, depth = 0;
    while (node.parentElement && depth < 8 && clickableByStyle(node.parentElement)) { node = node.parentElement; depth++; }
    return node;
  };
  const send = (action, e) => {
    try {
      const el = e.target || {};
      const tag = (el.tagName || '').toLowerCase();
      const type = ((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
      // Record only COMMITTED field values (change), clicks, and submits — never
      // per-keystroke input. Typing a field therefore yields ONE fill with its
      // final value instead of one record per key.
      let normalized = action;
      if (action === 'change') {
        normalized = tag === 'select' ? 'select' : type === 'checkbox' || type === 'radio' ? 'check' : 'fill';
      }
      // For clicks, attach the element's document-space rect so main can grab a
      // clipped screenshot (thumbnail) of exactly what was clicked.
      let rect;
      if (normalized === 'click' && el.getBoundingClientRect) {
        const r = el.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          rect = { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
        }
      }
      if (typeof window.__coachRecord === 'function') {
        window.__coachRecord(JSON.stringify({
          kind: 'action',
          type: normalized,
          target: targetOf(el),
          value: normalized === 'fill' || normalized === 'select' ? valueOf(el) : undefined,
          checked: normalized === 'check' ? !!el.checked : undefined,
          rect,
          ts: Date.now(),
          url: location.href
        }));
      }
    } catch (_) {}
  };
  // No 'input' listener → no keystroke spam. Clicks on form controls (text fields,
  // checkboxes, radios, selects) are skipped because their meaningful action is
  // recorded on 'change'; only clicks on buttons / links / other elements are kept.
  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (isFormControl(el)) return; // form controls are recorded on 'change', not click
    const act = actionableTarget(el);
    if (!act) return; // plain layout <div> / text / whitespace with no clickable behaviour — skip
    send('click', { target: act });
  }, true);
  document.addEventListener('change', (e) => send('change', e), true);
  document.addEventListener('submit', (e) => send('submit', e), true);
})();
`

const BODY_LIMIT = 20_000
const REQUEST_BODY_LIMIT = 12_000

// Light, SAFE fingerprint normalization for the operation view, injected at document-start in the
// MAIN world. Kept minimal on purpose — only things that make Electron look more like genuine Chrome
// WITHOUT risk: (1) the window.chrome shell Electron lacks, (2) outer≈inner window dims (the embedded
// view is only PART of the app window, so the raw gap mimics a docked DevTools panel — a reCAPTCHA
// heuristic). We deliberately do NOT patch navigator.webdriver/languages/permissions on the instance:
// those add detectable own-properties and backfired in testing. Injected via the Page domain only
// (never Runtime), so it never enables the event stream reCAPTCHA probes for. Best-effort; pure
// page-environment normalization, no functional impact.
const STEALTH = `
(() => {
  // Pin outer≈inner so the operation view doesn't look like a browser with a docked DevTools panel.
  try {
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 79, configurable: true });
  } catch (_) {}
  // window.chrome: Electron's is an empty shell; genuine Chrome exposes runtime/app/csi/loadTimes.
  // Only fill what's missing. runtime.connect/sendMessage throw like real Chrome (no extension ctx).
  try {
    const w = window;
    if (!w.chrome) w.chrome = {};
    if (!w.chrome.runtime) {
      w.chrome.runtime = {
        id: undefined,
        connect: function connect() { throw new TypeError('Error in invocation of runtime.connect(optional string extensionId, optional object connectInfo): chrome.runtime.connect() called from a webpage must specify an Extension ID (string) for its first argument.'); },
        sendMessage: function sendMessage() { throw new TypeError('Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function responseCallback): chrome.runtime.sendMessage() called from a webpage must specify an Extension ID (string) for its first argument.'); }
      };
    }
    if (!w.chrome.csi) w.chrome.csi = function csi() { return { onloadT: Date.now(), startE: Date.now(), pageT: 0, tran: 15 }; };
    if (!w.chrome.loadTimes) {
      w.chrome.loadTimes = function loadTimes() {
        const t = Date.now() / 1000;
        return {
          commitLoadTime: t, connectionInfo: 'h2', finishDocumentLoadTime: t, finishLoadTime: t,
          firstPaintAfterLoadTime: 0, firstPaintTime: t, navigationType: 'Other', npnNegotiatedProtocol: 'h2',
          requestTime: t, startLoadTime: t, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true,
          wasNpnNegotiated: true
        };
      };
    }
    if (!w.chrome.app) {
      w.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: function getDetails() { return null; },
        getIsInstalled: function getIsInstalled() { return false; }
      };
    }
  } catch (_) {}
})();
`

/**
 * In-process CDP capture over a WebContentsView's webContents.debugger.
 * No remote debugging port, no external CDP client.
 */
export class DebuggerCapture {
  private readonly pending = new Map<
    string,
    { url: string; status: number; mime: string; headers?: HeaderMap; timing?: NetworkTiming; streamingEarlyEmitted?: boolean }
  >()
  private readonly bodyStats = new Map<
    string,
    { chunkCount: number; decodedDataLength: number; encodedDataLength: number }
  >()
  private interceptionRules: NetworkInterceptionRule[] = []
  private fetchInterceptionEnabled = false
  private attached = false
  private navigationPreparation: Promise<void> | null = null
  private attachmentGeneration = 0
  private suspended = false
  private detaching = false
  private debuggerEventsWired = false
  // The Runtime/Page recording bridge is enabled lazily (only while recording), so track it
  // separately from `attached`. injectScriptId is the addScriptToEvaluateOnNewDocument handle,
  // removed on stopRecording.
  private recording = false
  private injectScriptId: string | null = null

  constructor(
    private readonly wc: WebContents,
    private readonly onEvent: (e: TraceEvent) => void,
    // Gate the per-click element thumbnail: only shoot when this returns true (active tab
    // + recording). Page.captureScreenshot(captureBeyondViewport) forces a surface reflow,
    // so firing it on every click when NOT recording is wasted work AND a visible render
    // glitch — and onCapturedEvent drops the event anyway. Defaults to always-on.
    private readonly shouldShoot: () => boolean = () => true
  ) {}

  /** Required first-request setup is independent of injection into the current document. */
  prepareNavigation(): Promise<void> {
    if (this.suspended || this.wc.isDestroyed()) return Promise.reject(new Error('Browser capture is unavailable.'))
    if (this.navigationPreparation) return this.navigationPreparation
    const generation = ++this.attachmentGeneration
    let timer: ReturnType<typeof setTimeout> | undefined
    const preparation = Promise.race([
      this.attachRequired(generation),
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Browser navigation preparation timed out.')), 5000)
      })
    ]).catch((error) => {
      if (generation === this.attachmentGeneration) {
        this.detach()
        if (!this.isTeardownError(error)) this.onEvent({ kind: 'error', msg: 'capture setup failed: ' + (error as Error).message, ts: Date.now() })
      }
      throw error
    }).finally(() => { if (timer) clearTimeout(timer) })
    this.navigationPreparation = preparation
    // A spare may never be claimed. Its failure is handled by the eventual navigation caller.
    void preparation.catch(() => {})
    return preparation
  }

  async attach(): Promise<void> {
    if (this.suspended || this.wc.isDestroyed()) return
    await this.prepareNavigation()
    if (!this.attached || this.suspended || this.wc.isDestroyed()) return
    try {
      await this.wc.debugger.sendCommand('Runtime.evaluate', { expression: STEALTH })
    } catch {
      // The registered document-start script covers the next page; this patch is best-effort.
    }
  }

  private async attachRequired(generation: number): Promise<void> {
    this.detaching = false
    const dbg = this.wc.debugger
    dbg.attach('1.3')
    this.attached = true
    if (!this.debuggerEventsWired) {
      dbg.on('detach', this.onDetach)
      dbg.on('message', this.onMessage)
      this.debuggerEventsWired = true
    }
    const assertCurrent = (): void => {
      if (generation !== this.attachmentGeneration || this.suspended || !this.attached || this.wc.isDestroyed()) {
        throw new Error('Browser navigation preparation was cancelled.')
      }
    }
    await dbg.sendCommand('Network.enable', {
      maxTotalBufferSize: 50_000_000,
      maxResourceBufferSize: 10_000_000
    })
    assertCurrent()
    // Existing request interception must be installed before the first remote request as well.
    await this.syncFetchInterception(true)
    assertCurrent()
    const id = chromeIdentity()
    await dbg.sendCommand('Network.setUserAgentOverride', {
      userAgent: id.userAgent,
      acceptLanguage: id.acceptLanguage,
      platform: id.navigatorPlatform,
      userAgentMetadata: id.metadata
    })
    assertCurrent()
    await dbg.sendCommand('Page.enable')
    assertCurrent()
    await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: STEALTH })
    assertCurrent()
    // Runtime.enable remains recording-only: ordinary browsing must not enable its event stream.
  }

  isAttached(): boolean {
    return this.attached
  }

  isSuspended(): boolean {
    return this.suspended
  }

  suspend(): void {
    this.suspended = true
    this.detach()
  }

  async resume(): Promise<void> {
    if (!this.suspended && this.attached) return
    this.suspended = false
    await this.attach()
  }

  async setInterceptionRules(rules: NetworkInterceptionRule[]): Promise<void> {
    this.interceptionRules = rules.map((rule) => ({ ...rule }))
    await this.syncFetchInterception()
  }

  /**
   * Turn ON the click/input recording bridge. This enables the Runtime event stream
   * (`Runtime.enable`) — which anti-bot scripts can detect — so call it ONLY while the user is
   * actively recording, never during normal browsing/login. Idempotent.
   */
  async startRecording(): Promise<void> {
    if (this.suspended || !this.attached || this.recording || this.wc.isDestroyed()) return
    const dbg = this.wc.debugger
    try {
      await dbg.sendCommand('Page.enable')
      await dbg.sendCommand('Runtime.enable')
      await dbg.sendCommand('Runtime.addBinding', { name: '__coachRecord' })
      const res = (await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: INJECT
      })) as { identifier?: string }
      this.injectScriptId = res.identifier ?? null
      // Hook the already-loaded page too (addScriptToEvaluateOnNewDocument only fires on the
      // NEXT load).
      try {
        await dbg.sendCommand('Runtime.evaluate', { expression: INJECT })
      } catch {
        /* no live document yet */
      }
      this.recording = true
    } catch (err) {
      if (!this.isTeardownError(err)) {
        this.onEvent({ kind: 'error', msg: 'start recording failed: ' + (err as Error).message, ts: Date.now() })
      }
    }
  }

  /**
   * Turn OFF the recording bridge and (unless `keepRuntime`) disable the Runtime event stream,
   * so the page goes back to undetectable. Page stays enabled — it's not a tell, and the stealth
   * override script lives on it. `keepRuntime` is reserved for a trusted first-party debugger
   * client that independently owns Runtime; ordinary recording call sites never couple it to a
   * tab kind. (The AI-CRMS login tab was that client until the provider was retired in 2026-09;
   * the flag stays because the coupling it prevents is a property of this class, not of that tab.)
   */
  async stopRecording(opts: { keepRuntime?: boolean } = {}): Promise<void> {
    if (!this.attached || !this.recording || this.wc.isDestroyed()) return
    this.recording = false
    const dbg = this.wc.debugger
    if (this.injectScriptId) {
      await dbg
        .sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.injectScriptId })
        .catch(() => {})
      this.injectScriptId = null
    }
    await dbg.sendCommand('Runtime.removeBinding', { name: '__coachRecord' }).catch(() => {})
    if (!opts.keepRuntime) {
      await dbg.sendCommand('Runtime.disable').catch(() => {})
    }
  }

  // True when an error is the expected "tab closed mid-operation" race (the CDP target is
  // gone), so callers can swallow it instead of logging noise.
  private isTeardownError(err: unknown): boolean {
    return (
      this.wc.isDestroyed() ||
      /target closed|detached|destroyed|not attached/i.test(String((err as Error)?.message ?? ''))
    )
  }

  /**
   * Capture a simplified DOM "element" tree of the live page (the Snapshot
   * button). Runs a self-contained walker in the page, prunes to interactive +
   * structural nodes, and returns it as a YAML structure tree.
   */
  async snapshot(
    opts: { shot?: boolean } = {}
  ): Promise<{ ok: boolean; nodeCount: number; title?: string; epoch?: string; yaml: string; shot?: string; error?: string }> {
    if (!this.attached) return { ok: false, nodeCount: 0, yaml: '', error: 'capture not attached' }
    try {
      const response = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(${snapshotWalker})()`,
        returnByValue: true
      })) as {
        result?: {
          value?: {
            title?: string
            epoch?: string
            count: number
            truncated?: boolean
            deepened?: boolean
            missingLines?: number
            missingSample?: string[]
            nodes: AriaNode[]
          }
        }
      }
      const value = response.result?.value
      if (!value || !Array.isArray(value.nodes)) {
        return { ok: false, nodeCount: 0, yaml: '', error: 'no snapshot returned' }
      }
      const yaml = composeSnapshotYaml(value)
      // Only the manual Snapshot button asks for a thumbnail; the agent's observe loop
      // doesn't, so we don't pay for a screenshot on every observe.
      const shot = opts.shot ? await this.captureViewportShot() : undefined
      return { ok: true, nodeCount: value.count, title: value.title, epoch: value.epoch, yaml, shot }
    } catch (err) {
      return { ok: false, nodeCount: 0, yaml: '', error: (err as Error).message }
    }
  }

  /**
   * `/page_snapshot_compare` 的取数一步:树 + DOM 原文 + 诊断,**一次往返**。
   *
   * 分开两次取会让两份来自不同瞬间 —— 而这条命令要诊断的恰恰是"页面和树对不上"。
   * 更硬的一条:诊断靠的是 walker 刚写上的 `[data-coach-ref]`,而每次快照开头都会先清掉
   * 上一轮的标记,所以做差必须和走树在同一次 evaluate 里完成,没有第二种写法。
   */
  async snapshotCompare(): Promise<{
    ok: boolean
    nodeCount?: number
    title?: string
    yaml?: string
    html?: string
    gaps?: SnapshotGap[]
    benign?: number
    meta?: Record<string, unknown>
    error?: string
  }> {
    if (!this.attached) return { ok: false, error: 'capture not attached' }
    try {
      const response = (await this.wc.debugger.sendCommand('Runtime.evaluate', {
        expression: `(${comparePayload})(${snapshotWalker})`,
        returnByValue: true
      })) as { result?: { value?: ReturnType<typeof comparePayload> } }
      const value = response.result?.value
      if (!value || !value.snapshot || !Array.isArray(value.snapshot.nodes)) {
        return { ok: false, error: 'no snapshot returned' }
      }
      return {
        ok: true,
        nodeCount: value.snapshot.count,
        title: value.snapshot.title,
        yaml: composeSnapshotYaml(value.snapshot),
        html: value.html,
        gaps: value.gaps,
        benign: value.benign,
        meta: value.meta
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /** Viewport JPEG → base64 data URL, for the snapshot record thumbnail. Best-effort. */
  private async captureViewportShot(): Promise<string | undefined> {
    try {
      const res = (await this.wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 50,
        fromSurface: true
      })) as { data?: string }
      return res.data ? `data:image/jpeg;base64,${res.data}` : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Grab a clipped JPEG screenshot of a clicked element and return it as a base64
   * data URL. The rect is in document (page) CSS pixels, matching captureBeyondViewport.
   * Capped so a click on a huge container can't produce a giant image. Best-effort:
   * returns undefined (action still recorded, just without a thumb) on any failure.
   */
  private async captureElementShot(rect: unknown): Promise<string | undefined> {
    const r = (rect ?? {}) as Record<string, unknown>
    const x = Number(r.x)
    const y = Number(r.y)
    const width = Number(r.width)
    const height = Number(r.height)
    if (!(width > 0 && height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined
    const MAX_W = 640
    const MAX_H = 480
    try {
      const res = (await this.wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 60,
        clip: { x, y, width: Math.min(width, MAX_W), height: Math.min(height, MAX_H), scale: 1 },
        captureBeyondViewport: true,
        fromSurface: true
      })) as { data?: string }
      return res.data ? `data:image/jpeg;base64,${res.data}` : undefined
    } catch {
      // teardown race / detached target / clip out of bounds — skip the thumb silently.
      return undefined
    }
  }

  /**
   * **接管文件选择器**（Ral 2026-08-16：「上传或下载文件时可能都会选择目录,这需要被拦截,
   * 并且 Agent 要能感知到」；本次随录制状态一起从 cowork 移植）。
   *
   * `will-download` 只盖住「文件已经开始下载」那一步。`<input type="file">` 走的是**另一套**：
   * Chromium 直接弹原生选择器，Electron 层没有任何事件拦得住。CDP 的
   * `Page.setInterceptFileChooserDialog` 是唯一正规入口 —— 开了之后 Chromium **不再弹框**，
   * 改发一条 `Page.fileChooserOpened` 交给我们。
   *
   * 为什么必须拦：选择器是**模态**的，弹出来之后 agent 的 CDP 操作全打在它上面，
   * 这一轮就地卡死，外面只看到 stalled。
   *
   * **只在录制期间开**（调用方保证）。一直开着的话，人平时用浏览器也再传不了文件 ——
   * 那是把一个 agent 的需要变成整个应用的残疾。
   *
   * 失败不致命：老 Chromium 没这条命令，拦不住最多回到"可能弹框"，不该因此让录制起不来。
   */
  async setFileChooserIntercept(enabled: boolean): Promise<void> {
    if (this.wc.isDestroyed()) return
    await this.wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled }).catch((err) => {
      this.onEvent({
        kind: 'error',
        msg: `file chooser intercept ${enabled ? 'on' : 'off'} failed: ${(err as Error).message}`,
        ts: Date.now()
      })
    })
  }

  private onMessage = async (_e: unknown, method: string, params: Record<string, any>): Promise<void> => {
    const dbg = this.wc.debugger
    try {
      if (method === 'Page.fileChooserOpened') {
        /**
         * 文件选择器被接管了 —— **什么都不做就是拦截**：`setInterceptFileChooserDialog` 开着时
         * Chromium 不会弹框，也不会自己继续；不调 `DOM.setFileInputFiles` 这次选择就无声作废，
         * 页面拿到一个空的 file input。这正是我们要的。
         *
         * 只上报，**不代填** —— 代填等于替人做了「上传哪个文件」的决定，而那是**写操作**的入口：
         * 文件真会被传到客户系统里去。
         *
         * 注意这不是"打断"：选择器压根没弹出来，页面拿到一个空 input，JS 继续往下跑，
         * 录制一秒都没停。对 agent 而言它等价于"人按了取消"。
         */
        this.onEvent({
          kind: 'error',
          msg: `file chooser blocked (mode=${String(params?.mode || 'selectSingle')})`,
          ts: Date.now()
        })
        return
      }
      if (method === 'Fetch.requestPaused') {
        await this.handleFetchPaused(params)
      } else if (method === 'Network.requestWillBeSent') {
        const postData = truncateNullable(params.request.postData, REQUEST_BODY_LIMIT)
        this.onEvent({
          kind: 'net.request',
          requestId: params.requestId,
          method: params.request.method,
          url: params.request.url,
          resourceType: params.type,
          headers: normalizeHeaders(params.request.headers),
          postData: postData.text,
          postDataTruncated: postData.truncated,
          ts: Date.now()
        })
      } else if (method === 'Network.responseReceived') {
        const meta = {
          url: params.response.url,
          status: params.response.status,
          mime: params.response.mimeType,
          headers: normalizeHeaders(params.response.headers),
          timing: normalizeNetworkTiming(params.response.timing),
          streamingEarlyEmitted: false
        }
        if (isStreamingResponseMime(meta.mime)) {
          meta.streamingEarlyEmitted = true
          this.onEvent({
            kind: 'net.response',
            requestId: params.requestId,
            status: meta.status,
            mime: meta.mime,
            url: meta.url,
            headers: meta.headers,
            bodyPreview: null,
            bodyOmittedReason: 'streaming',
            bodyStreamed: true,
            bodyChunkCount: 0,
            decodedDataLength: 0,
            encodedDataLength: 0,
            timing: meta.timing,
            ts: Date.now()
          })
        }
        this.pending.set(params.requestId, meta)
      } else if (method === 'Network.dataReceived') {
        const stats = this.bodyStats.get(params.requestId) || { chunkCount: 0, decodedDataLength: 0, encodedDataLength: 0 }
        stats.chunkCount += 1
        if (typeof params.dataLength === 'number') stats.decodedDataLength += params.dataLength
        if (typeof params.encodedDataLength === 'number') stats.encodedDataLength += params.encodedDataLength
        this.bodyStats.set(params.requestId, stats)
      } else if (method === 'Network.loadingFinished') {
        const meta = this.pending.get(params.requestId)
        this.pending.delete(params.requestId)
        const stats = this.bodyStats.get(params.requestId)
        this.bodyStats.delete(params.requestId)
        if (!meta) return
        let bodyPreview: string | null = null
        let bodyTruncated = false
        let bodyOmittedReason: ResponseBodyOmittedReason | undefined
        let bodyByteLength: number | undefined
        let bodyBase64Encoded: boolean | undefined
        const responseMime = meta.mime || ''
        const encodedLength = typeof params.encodedDataLength === 'number' ? params.encodedDataLength : undefined
        const bodyPolicy = classifyResponseBodyCapture({
          mime: responseMime,
          encodedDataLength: encodedLength,
          bodyLimit: BODY_LIMIT
        })
        if (bodyPolicy.captureBody) {
          try {
            const { body, base64Encoded } = (await dbg.sendCommand('Network.getResponseBody', {
              requestId: params.requestId
            })) as { body: string; base64Encoded: boolean }
            bodyBase64Encoded = base64Encoded || undefined
            let text = ''
            if (base64Encoded) {
              bodyByteLength = base64DecodedLength(body)
              const buffer = Buffer.from(body, 'base64')
              if (bodyPolicy.mode === 'image-data-url') {
                text = `data:${normalizeResponseMime(responseMime) || 'application/octet-stream'};base64,${body}`
              } else if (isProbablyBinaryBuffer(buffer)) {
                bodyOmittedReason = 'binary'
              } else {
                text = buffer.toString('utf8')
              }
            } else {
              bodyByteLength = Buffer.byteLength(body, 'utf8')
              text = body
            }
            if (text) {
              const truncated = truncateNullable(text, BODY_LIMIT)
              bodyPreview = truncated.text
              bodyTruncated = truncated.truncated
            } else if (!bodyOmittedReason) {
              bodyOmittedReason = 'empty'
            }
          } catch {
            bodyOmittedReason = 'get-body-failed'
          }
        } else {
          bodyOmittedReason = bodyPolicy.omittedReason
        }
        this.onEvent({
          kind: 'net.response',
          requestId: params.requestId,
          status: meta.status,
          mime: meta.mime,
          url: meta.url,
          headers: meta.headers,
          bodyPreview,
          bodyTruncated,
          bodyOmittedReason: bodyPreview ? undefined : bodyOmittedReason,
          bodyByteLength,
          bodyBase64Encoded,
          bodyStreamed: meta.streamingEarlyEmitted || bodyOmittedReason === 'streaming' || undefined,
          bodyChunkCount: stats?.chunkCount,
          decodedDataLength: stats?.decodedDataLength,
          encodedDataLength: encodedLength ?? stats?.encodedDataLength,
          timing: meta.timing,
          ts: Date.now()
        })
      } else if (method === 'Network.loadingFailed') {
        this.pending.delete(params.requestId)
        this.bodyStats.delete(params.requestId)
      } else if (method === 'Runtime.bindingCalled' && params.name === '__coachRecord') {
        try {
          const payload = JSON.parse(params.payload)
          const event = toActionTrace(payload)
          // Clicks get a thumbnail of the clicked element. Display-only — stripped before
          // the trace is persisted / ingested (CaptureService.emit).
          if (event.kind === 'action' && event.type === 'click' && payload.rect && this.shouldShoot()) {
            const shot = await this.captureElementShot(payload.rect)
            if (shot) event.shot = shot
          }
          this.onEvent(event)
        } catch {
          /* ignore malformed payload */
        }
      }
    } catch (err) {
      this.onEvent({ kind: 'error', msg: 'cdp handler: ' + (err as Error).message, ts: Date.now() })
    }
  }

  detach(): void {
    this.attachmentGeneration += 1
    this.navigationPreparation = null
    if (!this.attached) return
    this.detaching = true
    try {
      this.wc.debugger.detach()
    } catch {
      /* already detached */
      this.detaching = false
    }
    this.attached = false
    this.recording = false
    this.injectScriptId = null
    this.fetchInterceptionEnabled = false
  }

  private onDetach = (_e: unknown, reason: string): void => {
    this.attachmentGeneration += 1
    this.navigationPreparation = null
    const expected = this.detaching
    this.detaching = false
    this.attached = false
    this.recording = false
    this.injectScriptId = null
    this.fetchInterceptionEnabled = false
    if (!expected) this.onEvent({ kind: 'error', msg: 'debugger detached: ' + reason, ts: Date.now() })
  }

  private async syncFetchInterception(required = false): Promise<void> {
    if (!this.attached) return
    const dbg = this.wc.debugger
    const stages = interceptionStagesForRules(this.interceptionRules)
    if (!stages.length) {
      if (!this.fetchInterceptionEnabled) return
      try {
        await dbg.sendCommand('Fetch.disable')
      } catch {
        /* best-effort */
      }
      this.fetchInterceptionEnabled = false
      return
    }
    const patterns = stages.map((stage) => ({
      urlPattern: '*',
      requestStage: stage === 'response' ? 'Response' : 'Request'
    }))
    try {
      await dbg.sendCommand('Fetch.enable', { patterns })
      this.fetchInterceptionEnabled = true
    } catch (err) {
      this.onEvent({ kind: 'error', msg: 'Fetch.enable failed: ' + (err as Error).message, ts: Date.now() })
      if (required) throw err
    }
  }

  private async handleFetchPaused(params: Record<string, any>): Promise<void> {
    const requestId = String(params.requestId || '')
    const request = params.request || {}
    const stage = typeof params.responseStatusCode === 'number' || params.responseHeaders ? 'response' : 'request'
    const rule = findMatchingInterceptionRule(this.interceptionRules, {
      stage,
      method: request.method,
      url: request.url
    })
    if (!rule) {
      await this.continueFetchRequest(requestId, stage)
      return
    }
    try {
      if (rule.action === 'block') {
        await this.wc.debugger.sendCommand('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
      } else if (rule.action === 'mock_response' || rule.action === 'rewrite_response') {
        const body = rule.body
        const bodyBase64 = body == null && rule.action === 'rewrite_response'
          ? await this.pausedResponseBodyBase64(requestId)
          : Buffer.from(body ?? '', 'utf8').toString('base64')
        const headers = mergeHeaders(fetchHeaderEntriesToMap(params.responseHeaders), rule.headers) || {}
        if (body && !hasHeader(headers, 'content-type')) headers['content-type'] = 'application/json; charset=utf-8'
        await this.wc.debugger.sendCommand('Fetch.fulfillRequest', {
          requestId,
          responseCode: rule.status || params.responseStatusCode || 200,
          responseHeaders: headerEntriesForFetch(headers),
          body: bodyBase64
        })
      } else if (rule.action === 'rewrite_request') {
        const mergedHeaders = mergeHeaders(request.headers, rule.rewriteHeaders)
        await this.wc.debugger.sendCommand('Fetch.continueRequest', {
          requestId,
          url: rule.rewriteUrl,
          method: rule.rewriteMethod,
          headers: headerEntriesForFetch(mergedHeaders)
        })
      } else {
        await this.continueFetchRequest(requestId, stage)
      }
      this.onEvent({ kind: 'info', msg: `network intercept applied: ${interceptionRuleSummary(rule)}`, ts: Date.now() })
      if (rule.once) {
        this.interceptionRules = this.interceptionRules.filter((item) => item.id !== rule.id)
        await this.syncFetchInterception()
      }
    } catch (err) {
      this.onEvent({ kind: 'error', msg: 'network intercept failed: ' + (err as Error).message, ts: Date.now() })
      await this.continueFetchRequest(requestId, stage)
    }
  }

  private async pausedResponseBodyBase64(requestId: string): Promise<string> {
    const result = (await this.wc.debugger.sendCommand('Fetch.getResponseBody', { requestId })) as {
      body?: string
      base64Encoded?: boolean
    }
    const body = String(result.body || '')
    return result.base64Encoded ? body : Buffer.from(body, 'utf8').toString('base64')
  }

  private async continueFetchRequest(requestId: string, stage: 'request' | 'response'): Promise<void> {
    if (!requestId) return
    try {
      if (stage === 'response') {
        try {
          await this.wc.debugger.sendCommand('Fetch.continueResponse', { requestId })
          return
        } catch {
          /* older CDP builds may not expose continueResponse */
        }
      }
      await this.wc.debugger.sendCommand('Fetch.continueRequest', { requestId })
    } catch (err) {
      this.onEvent({ kind: 'error', msg: 'Fetch.continue failed: ' + (err as Error).message, ts: Date.now() })
    }
  }
}

const truncateNullable = (value: unknown, limit: number): { text: string | null; truncated: boolean } => {
  if (typeof value !== 'string' || value.length === 0) return { text: null, truncated: false }
  return { text: value.slice(0, limit), truncated: value.length > limit }
}

const normalizeHeaders = (value: unknown): HeaderMap | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const headers: HeaderMap = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') headers[key] = raw
    else if (Array.isArray(raw)) headers[key] = raw.map((v) => String(v))
    else if (raw != null) headers[key] = String(raw)
  }
  return headers
}

const networkTimingKeys: Array<keyof NetworkTiming> = [
  'requestTime',
  'proxyStart',
  'proxyEnd',
  'dnsStart',
  'dnsEnd',
  'connectStart',
  'connectEnd',
  'sslStart',
  'sslEnd',
  'workerStart',
  'workerReady',
  'workerFetchStart',
  'workerRespondWithSettled',
  'sendStart',
  'sendEnd',
  'pushStart',
  'pushEnd',
  'receiveHeadersStart',
  'receiveHeadersEnd'
]

const normalizeNetworkTiming = (value: unknown): NetworkTiming | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const timing: NetworkTiming = {}
  for (const key of networkTimingKeys) {
    const v = raw[key]
    if (typeof v === 'number' && Number.isFinite(v)) timing[key] = v
  }
  return Object.keys(timing).length ? timing : undefined
}

const toActionTrace = (payload: Record<string, any>): TraceEvent => {
  const action = normalizeAction(payload.type)
  const target = normalizeTarget(payload.target)
  const value = typeof payload.value === 'string' ? payload.value : undefined
  const checked = typeof payload.checked === 'boolean' ? payload.checked : undefined
  const step: UiActionStep = {
    action,
    target,
    value,
    checked,
    yaml: ''
  }
  step.yaml = toStepYaml(step)
  return {
    kind: 'action',
    type: action,
    desc: describeStep(step),
    url: typeof payload.url === 'string' ? payload.url : '',
    selector: target.selector,
    value,
    step,
    ts: typeof payload.ts === 'number' ? payload.ts : Date.now()
  }
}

const normalizeAction = (value: unknown): UiActionStep['action'] => {
  if (value === 'fill' || value === 'submit' || value === 'select' || value === 'check') return value
  return 'click'
}

const normalizeTarget = (value: unknown): UiActionTarget => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const selector = asText(raw.selector) || asText(raw.tag) || 'body'
  const selectors = Array.isArray(raw.selectors)
    ? raw.selectors.map((v) => String(v)).filter(Boolean)
    : [selector]
  return {
    tag: asText(raw.tag) || 'element',
    selector,
    selectors: selectors.length ? selectors : [selector],
    role: asOptionalText(raw.role),
    name: asOptionalText(raw.name),
    label: asOptionalText(raw.label),
    text: asOptionalText(raw.text),
    placeholder: asOptionalText(raw.placeholder),
    inputType: asOptionalText(raw.inputType)
  }
}

const asText = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : ''
}

const asOptionalText = (value: unknown): string | undefined => {
  const text = asText(value)
  return text || undefined
}

const describeStep = (step: UiActionStep): string => {
  const target = step.target.label || step.target.name || step.target.text || step.target.selector
  return `${step.action} ${step.target.role || step.target.tag} ${target}`.trim()
}

// One node of the accessibility tree, in the shape of Playwright's
// `ariaSnapshot({ mode: 'ai' })`: a role + accessible name + ARIA props, and a stable
// `ref` (eN) the agent uses to act on the element. Built in-page by snapshotWalker;
// rendered to YAML by toAriaYaml in the main process.
interface AriaNode {
  role: string
  name?: string
  ref?: string
  level?: number
  checked?: boolean | 'mixed'
  selected?: boolean
  disabled?: boolean
  expanded?: boolean
  value?: string
  url?: string
  nameAttr?: string
  idKind?: 'testid' | 'id'
  ident?: string
  note?: string
  children?: AriaNode[]
}

// Serialized into the page and run via Runtime.evaluate. Self-contained (no outer
// scope). Walks the DOM from <body> and builds an accessibility tree like Playwright's
// aria snapshot: each kept node carries role + accessible name + ARIA state, and is
// stamped with a stable [data-coach-ref] so ui_act can act on it by ref. Layout-only
// wrappers collapse (their children promote); script/style/svg/hidden nodes are
// skipped. Coverage is NOT guaranteed: every gate here can drop a subtree, and a page
// can render text this walk cannot reach (closed shadow roots, cross-origin frames,
// canvas). So the walk ends by checking itself against innerText and reporting what it
// missed — an unread subtree and an empty one look identical in the tree, and that
// ambiguity is what once got a page of billing rows reported to a user as "no records".
const snapshotWalker = (): {
  title: string
  /** 本次走树的世代号。ref 只在同一世代内有效 —— 见清戳记处的注释。 */
  epoch: string
  count: number
  truncated: boolean
  deepened: boolean
  missingLines: number
  missingSample: string[]
  nodes: AriaNode[]
} => {
  const MAX_NODES = 6000
  const MAX_DEPTH = 60
  let count = 0
  let refSeq = 0
  let truncated = false
  let deepened = false
  const clean = (v: unknown, max = 200): string =>
    String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)
  const css = (v: unknown): string =>
    window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&')
  const directText = (el: Element): string => {
    let text = ''
    for (const node of Array.from(el.childNodes)) if (node.nodeType === 3) text += node.nodeValue || ''
    return clean(text, 240)
  }
  // Implicit ARIA role from tag/type, or the explicit role attribute.
  const roleOf = (el: Element): string | undefined => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit.split(/\s+/)[0]
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (tag === 'button' || type === 'button' || type === 'submit' || type === 'reset') return 'button'
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : undefined
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      if (type === 'hidden') return undefined
      return 'textbox'
    }
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'img') return 'img'
    if (tag === 'ul' || tag === 'ol') return 'list'
    if (tag === 'li') return 'listitem'
    if (tag === 'nav') return 'navigation'
    if (tag === 'table') return 'table'
    if (tag === 'tr') return 'row'
    if (tag === 'td') return 'cell'
    if (tag === 'th') return 'columnheader'
    if (tag === 'option') return 'option'
    if (tag === 'summary') return 'button'
    // Kept even when we cannot read inside: the agent must at least learn that a region
    // of the page is rendered by a frame, rather than see nothing there at all.
    if (tag === 'iframe' || tag === 'frame') return 'iframe'
    return undefined
  }
  const idText = (ids: string): string =>
    ids
      .split(/\s+/)
      .map((id) => {
        try {
          const e = document.getElementById(id)
          return clean(e && e.textContent)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
      .join(' ')
  // Roles whose accessible name comes from an associated <label> / wrapping label.
  const FORMCTRL = ['textbox', 'combobox', 'checkbox', 'radio', 'slider', 'listbox', 'spinbutton']
  // Roles whose accessible name comes from their own text content.
  const NAMED = ['button', 'link', 'heading', 'option', 'tab', 'menuitem', 'img', 'switch']
  const nameOf = (el: Element, role: string): string => {
    const aria = clean(el.getAttribute('aria-label'))
    if (aria) return aria
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      const t = idText(labelledby)
      if (t) return t
    }
    if (FORMCTRL.indexOf(role) >= 0) {
      if (el.id) {
        const lbl = document.querySelector('label[for="' + css(el.id) + '"]')
        const t = clean(lbl && lbl.textContent)
        if (t) return t
      }
      const wrap = el.closest('label')
      if (wrap && wrap !== el) {
        const t = clean(wrap.textContent)
        if (t) return t
      }
    }
    if (role === 'img') {
      const alt = clean(el.getAttribute('alt'))
      if (alt) return alt
    }
    if (NAMED.indexOf(role) >= 0) {
      const t = clean(el.textContent, 200)
      if (t) return t
    }
    const title = clean(el.getAttribute('title'))
    if (title) return title
    if (role === 'textbox' || role === 'combobox') {
      const ph = clean(el.getAttribute('placeholder'))
      if (ph) return ph
    }
    return ''
  }
  const isHidden = (el: Element): boolean => {
    try {
      if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true
      return el.getClientRects().length === 0
    } catch {
      return false
    }
  }
  // The ONE case where "no client rects" must not prune: `display: contents` makes an
  // element generate no box of its own, so getClientRects() is empty — but its children
  // still render. Pruning there loses a visible subtree (a ChatGPT billing list did
  // exactly this). aria-hidden/[hidden] still win: those mean "not in the a11y tree",
  // whatever the layout says. getComputedStyle only runs on the cold no-rects path.
  const isBoxlessPassthrough = (el: Element): boolean => {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false
    try {
      return window.getComputedStyle(el).display === 'contents'
    } catch {
      return false
    }
  }
  // A same-origin frame can be walked through contentDocument; a cross-origin one is
  // opaque to page script, so the gap is recorded on the iframe node itself.
  const frameBody = (el: Element): Element | null => {
    const tag = el.tagName.toLowerCase()
    if (tag !== 'iframe' && tag !== 'frame') return null
    try {
      return (el as HTMLIFrameElement).contentDocument?.body || null
    } catch {
      return null
    }
  }
  const isMeaningful = (el: Element): boolean => {
    if (roleOf(el)) return true
    if (el.getAttribute('contenteditable') === 'true') return true
    if (el.hasAttribute('tabindex') || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return true
    // Custom controls keyed by an intentional identifier or handler — e.g. a clickable
    // <div name="Btn_Registration"> / [data-testid] / inline [onclick].
    if (el.hasAttribute('name') || el.hasAttribute('data-testid') || el.hasAttribute('data-test') || el.hasAttribute('onclick')) return true
    // Text leaves (kept), except <label> whose text is consumed as a control's name.
    if (el.tagName.toLowerCase() !== 'label' && el.children.length === 0 && directText(el)) return true
    return false
  }
  const stamp = (el: Element): string => {
    const ref = 'e' + ++refSeq
    try {
      el.setAttribute('data-coach-ref', ref)
    } catch {
      /* ignore */
    }
    return ref
  }
  // Secondary identifier, shown ALONGSIDE the always-present name attr: data-testid,
  // or a human-looking id when there's no name/testid. Framework-generated ids are
  // skipped as noise.
  const identOf = (el: Element): { kind: 'testid' | 'id'; value: string } | null => {
    const testid = clean(el.getAttribute('data-testid') || el.getAttribute('data-test'), 80)
    if (testid) return { kind: 'testid', value: testid }
    if (el.hasAttribute('name')) return null
    const id = el.getAttribute('id') || ''
    if (
      id &&
      !/^[:#.]/.test(id) &&
      !/^(react|mui|radix|headlessui|ember|ng-|cdk|svelte|v-|el-)/i.test(id) &&
      !/^[0-9a-f]{8,}$/i.test(id) &&
      !/\d{5,}/.test(id)
    ) {
      return { kind: 'id', value: clean(id, 80) }
    }
    return null
  }
  const describe = (el: Element): AriaNode => {
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute('type') || '').toLowerCase()
    const ident = identOf(el)
    const nameAttr = clean(el.getAttribute('name'), 80)
    const leaf = el.children.length === 0 && !!directText(el)
    // A bare text leaf is role "text"; if it carries an identifier or handler it's a
    // real control — keep it generic so it gets a ref + ident, not a nameless text node.
    const interactive =
      !!nameAttr ||
      !!ident ||
      el.hasAttribute('tabindex') ||
      el.hasAttribute('onclick') ||
      el.getAttribute('contenteditable') === 'true'
    const role = roleOf(el) || (leaf && !interactive ? 'text' : 'generic')
    const node: AriaNode = { role, ref: stamp(el) }
    let name = role === 'text' ? directText(el) : nameOf(el, role)
    if (!name && role !== 'text' && leaf) name = directText(el)
    if (name) node.name = name
    // The HTML name attribute is ALWAYS surfaced when present (apps key controls off it).
    if (nameAttr) node.nameAttr = nameAttr
    if (ident) {
      node.idKind = ident.kind
      node.ident = ident.value
    }
    if (role === 'heading') {
      const m = /^h([1-6])$/.exec(tag)
      const lvl = m ? +m[1] : +(el.getAttribute('aria-level') || '0')
      if (lvl) node.level = lvl
    }
    const ariaChecked = el.getAttribute('aria-checked')
    if (ariaChecked === 'mixed') node.checked = 'mixed'
    else if (ariaChecked) node.checked = ariaChecked === 'true'
    else if (tag === 'input' && (type === 'checkbox' || type === 'radio')) node.checked = (el as HTMLInputElement).checked
    if (el.getAttribute('aria-selected') === 'true' || (tag === 'option' && (el as HTMLOptionElement).selected)) node.selected = true
    let disabled = el.getAttribute('aria-disabled') === 'true'
    try {
      if (el.matches(':disabled')) disabled = true
    } catch {
      /* :disabled unsupported — ignore */
    }
    if (disabled) node.disabled = true
    const exp = el.getAttribute('aria-expanded')
    if (exp === 'true' || exp === 'false') node.expanded = exp === 'true'
    if ((tag === 'input' || tag === 'textarea') && type !== 'password') {
      const v = clean((el as HTMLInputElement).value, 200)
      if (v) node.value = v
    }
    if (tag === 'select') {
      const v = clean((el as HTMLSelectElement).value, 200)
      if (v) node.value = v
    }
    if (role === 'iframe' && !frameBody(el)) {
      node.note = 'content not readable from this page (cross-origin frame)'
    }
    if (role === 'link' && tag === 'a') {
      const href = clean(el.getAttribute('href'), 200)
      if (href) node.url = href
    }
    return node
  }
  // <option>s have no client rects when the select is closed, so the generic walk
  // would skip them — list them explicitly as the combobox's children.
  const selectOptions = (el: HTMLSelectElement): AriaNode[] =>
    Array.from(el.options)
      .slice(0, 200)
      .map((opt) => {
        const node: AriaNode = { role: 'option', ref: stamp(opt) }
        const text = clean(opt.textContent, 160)
        if (text) node.name = text
        if (opt.value && opt.value !== text) node.value = clean(opt.value, 160)
        if (opt.selected) node.selected = true
        return node
      })
  // What actually renders under this element. An OPEN shadow root replaces the host's
  // light children as the rendered subtree — those are only reached through its <slot>s,
  // so walking el.children as well would double-count them. A <slot> resolves to the
  // nodes assigned to it, falling back to its own content when nothing is assigned.
  // A closed root is unreachable from page script; it is reported as a gap, not silence.
  const renderedChildren = (el: Element): Element[] => {
    const shadow = (el as HTMLElement).shadowRoot
    if (shadow) return Array.from(shadow.children)
    const body = frameBody(el)
    if (body) return Array.from(body.children)
    if (el.tagName.toLowerCase() === 'slot') {
      const assigned = (el as HTMLSlotElement).assignedElements()
      if (assigned.length) return assigned
    }
    return Array.from(el.children)
  }
  const walk = (el: Element, depth: number, boxless = false): AriaNode[] => {
    if (count >= MAX_NODES) {
      truncated = true
      return []
    }
    if (depth > MAX_DEPTH) {
      deepened = true
      return []
    }
    let childNodes: AriaNode[]
    if (el.tagName.toLowerCase() === 'select') {
      childNodes = selectOptions(el as HTMLSelectElement)
    } else {
      childNodes = []
      for (const child of renderedChildren(el)) {
        if (count >= MAX_NODES) {
          truncated = true
          break
        }
        const tag = child.tagName.toLowerCase()
        if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg' || tag === 'path') continue
        if (isHidden(child)) {
          if (!isBoxlessPassthrough(child)) continue
          // Walk through it, but never keep it: clicks are dispatched at an element's
          // viewport point, and a boxless node has none — a ref on it is unclickable.
          childNodes.push(...walk(child, depth + 1, true))
          continue
        }
        childNodes.push(...walk(child, depth + 1))
      }
    }
    if (!boxless && isMeaningful(el)) {
      count += 1
      const node = describe(el)
      if (childNodes.length) node.children = childNodes
      return [node]
    }
    return childNodes
  }
  // Clear stamps from a previous snapshot so refs always match the latest tree.
  //
  // **同一处盖世代号。** 清戳记 + 从 e1 重排意味着上一份快照的 `eN` 全部作废,但作废是
  // **静默**的:编号密集,旧的 e47 在新树里通常依然存在、只是指向另一个元素,而
  // `deepFindElement` 取第一个命中就返回 —— ui_act 会点错东西且不报错。世代号让这件事
  // 可判定:ui_act 带着它来,对不上就报错而不是照点。
  let epoch = 's1'
  try {
    const previous = Number(String(document.documentElement.getAttribute('data-coach-epoch') || '').slice(1))
    epoch = 's' + (Number.isFinite(previous) && previous > 0 ? previous + 1 : 1)
    document.querySelectorAll('[data-coach-ref]').forEach((el) => el.removeAttribute('data-coach-ref'))
    document.documentElement.setAttribute('data-coach-epoch', epoch)
  } catch {
    /* ignore */
  }
  const root = document.body || document.documentElement
  const nodes = root ? walk(root, 0) : []
  // Completeness self-check. Every gate above can drop a subtree, and a dropped subtree
  // is indistinguishable from an empty one in the output — which is how a page full of
  // transactions was reported as having none. So compare the tree against what the page
  // ACTUALLY renders: innerText is the browser's own answer to "what text is visible".
  // Lines it has that the tree does not are content the agent cannot see or act on.
  // This is deliberately a detector, not a fix: it also fires for blind spots we have
  // not found yet. Skipped when a bound already flagged the snapshot, or when the page
  // is big enough that the scan would cost more than the signal is worth.
  let missingLines = 0
  let missingSample: string[] = []
  try {
    const rendered = root && 'innerText' in root ? String((root as HTMLElement).innerText || '') : ''
    if (!truncated && rendered && rendered.length < 500000) {
      let captured = ''
      // innerText never renders form-control values, and a <label>'s text is in the tree only as
      // its control's name, so a value right after that name splits a line innerText renders whole
      // ("Search" + "ct" + "Go" vs "SearchGo"). Values are still compared — just after all names.
      let values = ''
      const soak = (list: AriaNode[]): void => {
        for (const node of list) {
          if (node.name) captured += ' ' + node.name
          if (node.value) values += ' ' + node.value
          if (node.children) soak(node.children)
        }
      }
      soak(nodes)
      captured += values
      // Names are not enough: an element named by aria-label/title/alt reports THAT, while the
      // page shows its own text (a chevron link labelled "Open invoice from …" renders ">"), so
      // comparing names alone reports lines that are in fact covered. Every kept element carries
      // a fresh [data-coach-ref], so add each one's DIRECT text — direct only, because a kept
      // ancestor's textContent would also include the pruned subtree this check exists to find.
      try {
        for (const el of Array.from(document.querySelectorAll('[data-coach-ref]'))) {
          // innerText skips the text of anything whose computed visibility is not `visible`, so do
          // the same — otherwise a hidden element that the tree keeps sits between two neighbours
          // that innerText has glued into one line, and that line never matches.
          if (window.getComputedStyle(el).visibility !== 'visible') continue
          for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === 3) captured += ' ' + (child.nodeValue || '')
          }
        }
      } catch {
        /* the self-check must never break the snapshot it is checking */
      }
      // innerText is RENDERED text, so CSS text-transform is already applied to it, while both
      // capture paths read the source text (nameOf → textContent, directText → nodeValue) and
      // never see that transform. Comparing them as-is makes every uppercased nav label read as
      // a gap — our own demo site reported "DEMO CENTER" and "BOOKING" as missing while both
      // were in the tree. So fold case for the COMPARISON, and keep the original line for the
      // message: the sample tells the agent what to look for ON THE PAGE, and a lowercased copy
      // of it is not on the page. toLowerCase, not toLocaleLowerCase — under a tr/az host locale
      // the latter maps "I" to dotless "ı" while the untransformed "i" stays "i", which would
      // invent a new false positive instead of removing one.
      // Whitespace is dropped the same way, for the comparison only: innerText puts NO separator
      // between adjacent inline elements with no whitespace between them in the DOM (typical JSX
      // output): a nav renders "HomeAboutPricing" while the capture joins its pieces with spaces.
      captured = captured.replace(/\s+/g, '').toLowerCase()
      const seen: Record<string, true> = {}
      const lines: { raw: string; key: string }[] = []
      for (const raw of rendered.split('\n')) {
        const line = raw.replace(/\s+/g, ' ').trim()
        const key = line.replace(/\s+/g, '').toLowerCase()
        if (line.length < 3 || seen[key]) continue
        seen[key] = true
        lines.push({ raw: line, key })
        if (lines.length >= 500) break
      }
      const candidates: { raw: string; key: string }[] = []
      for (const line of lines) {
        if (captured.indexOf(line.key) < 0) candidates.push(line)
      }
      // innerText still reports text the page deliberately hides from assistive tech.
      // Leaving it in would make almost every real page report a gap, and a warning that
      // fires always is a warning the agent learns to skip — so drop those lines here.
      let ariaHidden = ''
      if (candidates.length) {
        try {
          for (const el of Array.from(document.querySelectorAll('[aria-hidden="true"],[hidden]'))) {
            ariaHidden += ' ' + (el.textContent || '')
          }
          ariaHidden = ariaHidden.replace(/\s+/g, '').toLowerCase()
        } catch {
          ariaHidden = ''
        }
      }
      for (const line of candidates) {
        if (ariaHidden && ariaHidden.indexOf(line.key) >= 0) continue
        missingLines += 1
        if (missingSample.length < 5) missingSample.push(line.raw.slice(0, 60))
      }
    }
  } catch {
    /* the self-check must never break the snapshot it is checking */
  }
  return { title: clean(document.title, 200), epoch, count, truncated, deepened, missingLines, missingSample, nodes }
}

/** 一处剪枝点，连同它吞掉的可见文字。按剪枝点聚合，不是按叶子。 */
export interface SnapshotGap {
  culprit: string
  outer: string
  reason: string
  display: string
  rects: number
  leaves: number
  sample: string[]
}

// Serialized into the page and handed `snapshotWalker` (it is self-contained and cannot
// close over it). Runs the walk, then — in the SAME evaluation, while the fresh
// [data-coach-ref] stamps are still on the page — diffs the tree against the DOM and
// serializes the document. One round trip is the contract: taken separately the tree and
// the HTML can disagree, and "the page and the tree disagree" is the very thing this
// exists to diagnose.
const comparePayload = (
  walk: typeof snapshotWalker
): {
  snapshot: ReturnType<typeof snapshotWalker>
  html: string
  scriptsStripped: number
  gaps: SnapshotGap[]
  benign: number
  meta: Record<string, unknown>
} => {
  const snapshot = walk()
  const tidy = (v: unknown, max = 200): string =>
    String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)
  const directText = (el: Element): string => {
    let text = ''
    for (const node of Array.from(el.childNodes)) if (node.nodeType === 3) text += node.nodeValue || ''
    return tidy(text, 120)
  }
  const describeEl = (el: Element): string => {
    const cls = typeof el.className === 'string' ? tidy(el.className, 60) : ''
    return (
      el.tagName.toLowerCase() +
      (el.id ? '#' + tidy(el.id, 40) : '') +
      (cls ? '.' + cls.split(' ').filter(Boolean).join('.') : '')
    )
  }
  const SKIP = ['script', 'style', 'noscript', 'svg', 'path']

  // Same reach as the walk: this document, open shadow roots, same-origin frames. A closed
  // root or a cross-origin frame is invisible here too — the tree marks those instead.
  const roots: Array<Document | ShadowRoot> = [document]
  const collectRoots = (root: Document | ShadowRoot, depth: number): void => {
    if (depth > 8) return
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const shadow = (el as HTMLElement).shadowRoot
      if (shadow) {
        roots.push(shadow)
        collectRoots(shadow, depth + 1)
      }
      const tag = el.tagName.toLowerCase()
      if (tag !== 'iframe' && tag !== 'frame') continue
      let doc: Document | null = null
      try {
        doc = (el as HTMLIFrameElement).contentDocument
      } catch {
        doc = null
      }
      if (doc) {
        roots.push(doc)
        collectRoots(doc, depth + 1)
      }
    }
  }
  try {
    collectRoots(document, 0)
  } catch {
    /* best effort; a partial root list still diagnoses what it can reach */
  }

  const byCulprit: Record<string, SnapshotGap> = {}
  let benign = 0
  try {
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const tag = el.tagName.toLowerCase()
        // The walk's own text-leaf rule, verbatim. Anything else is not something it meant
        // to keep, and counting it here would invent gaps that are not gaps.
        if (SKIP.indexOf(tag) >= 0 || tag === 'label') continue
        if (el.children.length !== 0) continue
        const text = directText(el)
        if (!text) continue
        if (el.hasAttribute('data-coach-ref')) continue
        if (!el.getClientRects().length) continue

        let culprit: Element = el
        let reason = 'unknown — the walk should have reached this text'
        let defect = true
        const host = (el.getRootNode() as ShadowRoot).host
        if (el.ownerDocument !== document) {
          reason = 'inside a frame document — el.children does not cross it'
        } else if (host) {
          culprit = host
          reason = 'inside a shadow root — el.children does not cross it'
        } else {
          let depth = 0
          let found = false
          for (let node: Element | null = el; node; node = node.parentElement) {
            depth += 1
            if (node.hasAttribute('data-coach-ref')) break
            if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') {
              culprit = node
              reason = node.hasAttribute('hidden')
                ? '[hidden] — kept out by design, not a defect'
                : 'aria-hidden="true" — kept out by design, not a defect'
              defect = false
              found = true
              break
            }
            if (!node.getClientRects().length) {
              culprit = node
              let display = ''
              try {
                display = window.getComputedStyle(node).display
              } catch {
                display = ''
              }
              if (display === 'contents') {
                reason = 'display: contents — generates no box of its own, so the gate pruned its visible children'
              } else {
                reason = 'no client rects (display: ' + (display || 'unknown') + ') — genuinely not rendered, not a defect'
                defect = false
              }
              found = true
              break
            }
          }
          if (!found && depth > 60) reason = 'deeper than the walk depth limit'
        }
        if (!defect) {
          benign += 1
          continue
        }
        const key = describeEl(culprit) + ' :: ' + reason
        let display = ''
        let rects = 0
        try {
          display = window.getComputedStyle(culprit).display
          rects = culprit.getClientRects().length
        } catch {
          /* leave unknown */
        }
        const gap =
          byCulprit[key] ||
          (byCulprit[key] = {
            culprit: describeEl(culprit),
            outer: tidy(culprit.outerHTML, 200),
            reason,
            display,
            rects,
            leaves: 0,
            sample: []
          })
        gap.leaves += 1
        if (gap.sample.length < 5) gap.sample.push(text.slice(0, 60))
      }
    }
  } catch {
    /* the diagnosis must never break the export it is part of */
  }

  // The DOM copy carries the same [data-coach-ref] stamps the tree uses, so a ref in
  // snapshot.yml can be grepped straight out of page.html. Script and style bodies are
  // replaced: an accessibility tree never contains them, raw HTML does, and chatgpt.com's
  // own page ships a live access token inside one. This archive exists to be handed to
  // someone else, so stripping is the default, not an option.
  let html = ''
  let scriptsStripped = 0
  try {
    const clone = document.documentElement.cloneNode(true) as Element
    for (const el of Array.from(clone.querySelectorAll('script, style'))) {
      if (!el.textContent) continue
      el.textContent = '/* stripped by page_snapshot_compare */'
      scriptsStripped += 1
    }
    html = '<!doctype html>\n' + clone.outerHTML
  } catch (err) {
    html = '<!-- page.html unavailable: ' + String(err) + ' -->'
  }

  return {
    snapshot,
    html,
    scriptsStripped,
    gaps: Object.keys(byCulprit).map((key) => byCulprit[key]),
    benign,
    meta: {
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      userAgent: navigator.userAgent,
      roots: roots.length,
      scriptsStripped: true
    }
  }
}

// Render the aria tree as Playwright-`mode:'ai'`-style YAML:
//   - button "Save" [ref=e7]
//   - heading "Patients" [level=1] [ref=e2]
//   - combobox "Item" [value="CT26"] [ref=e9]:
//     - option "CT Lung" [selected] [ref=e10]
//   - link "Home" [ref=e4]:
//     - /url: /home
//   - text: Some label
// Apps often wrap an input in a named layout div: <div name="tbUserName"><input></div>,
// which the walker renders as a generic>generic>textbox chain where the identifier is
// on a wrapper and the operable element is buried. Collapse a NAMELESS generic wrapper
// that holds a single control, lifting the wrapper's identifier onto the control — so it
// becomes one operable node: `textbox "User Name" [name="tbUserName"] [ref=…]`.
const COLLAPSE_INTO_ROLES = [
  'textbox',
  'combobox',
  'checkbox',
  'radio',
  'button',
  'link',
  'slider',
  'switch',
  'spinbutton',
  'searchbox',
  'listbox',
  'menuitem',
  'option',
  'tab'
]
const collapseWrappers = (nodes: AriaNode[]): AriaNode[] => {
  const out: AriaNode[] = []
  for (const n of nodes) {
    if (n.children && n.children.length) n.children = collapseWrappers(n.children)
    if (
      n.role === 'generic' &&
      !n.name &&
      n.value === undefined &&
      !n.url &&
      n.children &&
      n.children.length === 1 &&
      COLLAPSE_INTO_ROLES.indexOf(n.children[0].role) >= 0
    ) {
      const child = n.children[0]
      // Nearest wrapper wins: only fill in an identifier the control doesn't already have.
      if (!child.nameAttr && n.nameAttr) child.nameAttr = n.nameAttr
      if (!child.ident && n.ident) {
        child.idKind = n.idKind
        child.ident = n.ident
      }
      out.push(child)
    } else {
      out.push(n)
    }
  }
  return out
}

const toAriaYaml = (nodes: AriaNode[], indent = ''): string => {
  const lines: string[] = []
  for (const n of nodes) {
    let line: string
    if (n.role === 'text') {
      line = indent + '- text: ' + (n.name || '')
    } else {
      line = indent + '- ' + n.role
      if (n.name) line += ' ' + JSON.stringify(n.name)
      if (n.level) line += ' [level=' + n.level + ']'
      if (n.checked === 'mixed') line += ' [checked=mixed]'
      else if (n.checked) line += ' [checked]'
      if (n.selected) line += ' [selected]'
      if (n.disabled) line += ' [disabled]'
      if (n.expanded !== undefined) line += ' [expanded=' + n.expanded + ']'
      if (n.value) line += ' [value=' + JSON.stringify(n.value) + ']'
      if (n.nameAttr) line += ' [name=' + JSON.stringify(n.nameAttr) + ']'
      if (n.ident) line += ' [' + (n.idKind || 'id') + '=' + JSON.stringify(n.ident) + ']'
      if (n.ref) line += ' [ref=' + n.ref + ']'
      if (n.note) line += ' -- ' + n.note
    }
    const kids = n.children && n.children.length ? n.children : []
    if (n.url || kids.length) {
      lines.push(line + ':')
      if (n.url) lines.push(indent + '  - /url: ' + n.url)
      if (kids.length) lines.push(toAriaYaml(kids, indent + '  '))
    } else {
      lines.push(line)
    }
  }
  return lines.join('\n')
}

const toStepYaml = (step: UiActionStep): string => {
  const target: Record<string, string> = { selector: step.target.selector }
  if (step.target.role) target.role = step.target.role
  if (step.target.label) target.label = step.target.label
  // The HTML name attribute — a stable identifier that matches the page snapshot's
  // [name=…], so a skill's recorded steps line up with what the agent observes.
  if (step.target.name) target.name = step.target.name
  if (step.target.placeholder) target.placeholder = step.target.placeholder
  const record: Record<string, unknown> = { action: step.action, target }
  if (step.value != null) record.value = step.value
  if (step.checked != null) record.checked = step.checked
  return stringifyYaml([record], { lineWidth: 120 }).trimEnd()
}

/**
 * 页头之下、树之上的那几行。每一处走树自己知道的缺口都写在**最前面** —— agent 先读到它,
 * 再读树。缺失的元素和没读到的元素在树里同形,所以这里的沉默正是把盲区变成假阴性的那一步。
 *
 * `snapshot()` 与 `snapshotCompare()` 共用这一份:两条路出的 yml 必须逐字一致,
 * 否则拿 compare 的导出去对照 agent 实际看到的那份就失去意义。
 */
const composeSnapshotYaml = (value: {
  nodes: AriaNode[]
  truncated?: boolean
  deepened?: boolean
  missingLines?: number
  missingSample?: string[]
}): string => {
  const nodes = collapseWrappers(value.nodes)
  const body = nodes.length ? toAriaYaml(nodes) : '# (no elements found)'
  const notes: string[] = []
  if (value.truncated) {
    notes.push('# NOTE: page is unusually large; snapshot hit the node safety bound — some elements omitted')
  }
  if (value.deepened) {
    notes.push('# NOTE: the DOM is deeper than the walk limit — elements below that depth are omitted')
  }
  if (value.missingLines) {
    const sample = (value.missingSample || []).map((line) => JSON.stringify(line)).join(', ')
    notes.push(
      `# INCOMPLETE: ${value.missingLines} line(s) of text are rendered on this page but are NOT in the tree below` +
        (sample ? ` (e.g. ${sample})` : '') +
        '. Treat this snapshot as a partial view: do NOT conclude content is absent. Read it another way ' +
        '(browser_exec / an API call), or act on it with ui_act {"selector":"<css>"} — a ref is not required.'
    )
  }
  return notes.length ? `${notes.join('\n')}\n${body}` : body
}
