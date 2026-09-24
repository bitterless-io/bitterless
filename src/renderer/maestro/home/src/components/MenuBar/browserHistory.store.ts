import { googleSearchUrl } from '@maestro-shared/browserAddress.service';
import { browserHistoryError, browserHistoryLog } from '@maestro-shared/browserHistoryDiagnostics.service';
import { nextTick, reactive } from 'vue';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import {
  BROWSER_HISTORY_ACTION_EVENT, BROWSER_HISTORY_CLOSED_EVENT,
  type BrowserHistoryPopupApi, type BrowserHistoryPopupAction,
} from '@maestro-shared/browserHistoryPopup.api';
import type { BrowserHistoryApi, BrowserHistoryEntry } from '@maestro-shared/browserHistory.api';
import type { CoachXpcContract, ViewRect } from '@maestro-shared/coach.api';

const popup = createXpcRendererEmitter<BrowserHistoryPopupApi>('BrowserHistoryPopupHandler');
const history = createXpcRendererEmitter<BrowserHistoryApi>('BrowserHistoryDao');
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler');
const SUGGEST_DEBOUNCE_MS = 90;

class BrowserHistoryState {
  open = false;
  entries: BrowserHistoryEntry[] = [];
  selectedIndex = -1;
  loading = false;
  error = false;
  composing = false;
  get candidateUrls(): string[] {
    const google = googleSearchUrl(this.query);
    return [...(google ? [google] : []), ...this.entries.map((entry) => entry.url)];
  }
  private input: HTMLInputElement | null = null;
  /**
   * 把地址栏拨回当前 active tab 的地址。**由 `menuBarStore` 注册,不在这里直接改。**
   *
   * 地址栏那串文本住在 `menuBarStore.url`(MenuBar.vue 的 `v-model`),而 `menuBar.store.ts:3`
   * 已经 `import { browserHistoryStore }` —— 反向 import 就是一个环。所以沿用已有的同向接缝
   * (`bind()` / `setActiveTab()` 都是 menuBar 往这边推),由那一侧注册一个回调。
   */
  private restoreAddress: (() => void) | null = null;
  private activeTabId = '';
  private session = Date.now();
  private revision = 0;
  private query = '';
  private suggestSeq = 0;
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;
  private focusSuppressed = false;
  private subscribed = false;
  private disposeListeners: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private anchor: ViewRect | null = null;

  bind(input: HTMLInputElement | null): void {
    this.dispose(); this.input = input;
    browserHistoryLog('address.bind', { hasInput: Boolean(input) });
    if (!input) return;
    if (!this.subscribed) {
      this.subscribed = true;
      xpcRenderer.subscribe(BROWSER_HISTORY_CLOSED_EVENT, (payload) => {
        if ((payload.params as { session: number }).session === this.session) this.hide('native-dismissal', false);
      });
      xpcRenderer.subscribe(BROWSER_HISTORY_ACTION_EVENT, (payload) => void this.action(payload.params as BrowserHistoryPopupAction));
    }
    const outside = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && (target === this.input || target.closest('[name="browser-history-toggle"]'))) return;
      this.hide('outside-pointer');
    };
    const resize = (): void => {
      const rect = this.input?.getBoundingClientRect();
      if (rect && (!this.anchor || rect.x !== this.anchor.x || rect.y !== this.anchor.y || rect.width !== this.anchor.width || rect.height !== this.anchor.height)) this.publish();
    };
    document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', resize);
    this.disposeListeners.push(() => document.removeEventListener('pointerdown', outside, true), () => window.removeEventListener('resize', resize));
    this.resizeObserver = new ResizeObserver(resize); this.resizeObserver.observe(input);
  }

  dispose(): void {
    this.hide('dispose');
    for (const dispose of this.disposeListeners.splice(0)) dispose();
    this.resizeObserver?.disconnect(); this.resizeObserver = null; this.input = null; this.anchor = null;
  }

  setActiveTab(id: string): void {
    if (id !== this.activeTabId) this.hide('tab-change');
    this.activeTabId = id;
  }

  /** See `restoreAddress`. Registered by `menuBarStore.bindAddressInput`. */
  setAddressRestorer(restore: () => void): void {
    this.restoreAddress = restore;
  }

  /**
   * 第 `index` 行是哪一类。`candidateUrls` = `[googleUrl?, ...entries]`,所以有查询词时第 0 项
   * 是 Google 行、其余是历史记录行;没有查询词(recents)时全是历史记录行。
   * `index < 0`(没有选中项,或这次是鼠标点击带着自己的 `row`)返回 undefined。
   */
  private rowKindAt(index: number): BrowserHistoryPopupAction['row'] | undefined {
    if (index < 0) return undefined;
    return googleSearchUrl(this.query) ? (index === 0 ? 'google' : 'history') : 'history';
  }

  focus(): void {
    browserHistoryLog('address.focus', { suppressed: this.focusSuppressed, hasInput: Boolean(this.input), disabled: Boolean(this.input?.disabled), open: this.open });
    if (this.focusSuppressed || !this.input || this.input.disabled || this.open || !this.input.value.trim()) return;
    this.show(this.input.value, false);
  }

  inputChanged(): void {
    const query = this.input?.value ?? '';
    browserHistoryLog('address.input', { nonblank: Boolean(query.trim()), composing: this.composing });
    if (!query.trim() || this.composing) { this.hide('blank-or-composing'); return; }
    this.show(query, true);
  }

  compositionStart(): void { this.composing = true; this.hide('composition'); }
  compositionEnd(): void { this.composing = false; this.inputChanged(); }

  toggle(): void {
    browserHistoryLog('address.toggle', { open: this.open, hasInput: Boolean(this.input), hasActiveTab: Boolean(this.activeTabId) });
    if (this.open) { this.hide('toggle'); return; }
    void this.focusInput(); this.show('', false);
  }

  blur(): void {
    browserHistoryLog('address.blur', { open: this.open });
    if (this.open) void popup.blur().catch((error) => {
      browserHistoryLog('address.blur.failure', browserHistoryError(error)); this.hide('blur-failure');
    });
  }

  private show(query: string, debounce: boolean): void {
    if (!this.input || !this.activeTabId) {
      browserHistoryLog('address.show.rejected', { hasInput: Boolean(this.input), hasActiveTab: Boolean(this.activeTabId) }); return;
    }
    if (!this.open) { this.session = Math.max(Date.now(), this.session + 1); this.revision = 0; }
    this.open = true; this.schedule(query, debounce);
  }

  private schedule(query: string, debounce: boolean): void {
    const seq = ++this.suggestSeq;
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    this.suggestTimer = null;
    this.query = query; this.entries = []; this.selectedIndex = -1; this.loading = true; this.error = false;
    this.publish();
    if (debounce) this.suggestTimer = setTimeout(() => { this.suggestTimer = null; void this.runSearch(query, seq); }, SUGGEST_DEBOUNCE_MS);
    else void this.runSearch(query, seq);
  }

  private async runSearch(query: string, seq: number): Promise<void> {
    browserHistoryLog('address.query.begin', { sequence: seq });
    try {
      const entries = await history.search({ query });
      browserHistoryLog('address.query.result', { sequence: seq, array: Array.isArray(entries), resultCount: Array.isArray(entries) ? entries.length : -1, stale: !this.open || seq !== this.suggestSeq });
      if (!this.open || seq !== this.suggestSeq) return;
      if (!Array.isArray(entries)) throw new Error('History storage unavailable');
      this.entries = entries;
    } catch (error) {
      browserHistoryLog('address.query.failure', { sequence: seq, ...browserHistoryError(error) });
      if (!this.open || seq !== this.suggestSeq) return;
      this.error = true;
    }
    this.loading = false; this.publish();
  }

  private publish(): void {
    if (!this.open || !this.input) return;
    const rect = this.input.getBoundingClientRect();
    if (rect.width <= 0) { browserHistoryLog('address.dispatch.rejected', { reason: 'empty-anchor' }); return; }
    const session = this.session;
    const revision = ++this.revision;
    this.anchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    browserHistoryLog('address.dispatch.begin', { revision, resultCount: this.entries.length, loading: this.loading, error: this.error });
    void popup.update({ session, revision, tabId: this.activeTabId, query: this.query,
      anchor: { ...this.anchor },
      entries: this.entries.map((entry) => ({ ...entry })), selectedIndex: this.selectedIndex, loading: this.loading, error: this.error,
    }).then((accepted) => {
      browserHistoryLog('address.dispatch.result', { revision, accepted: accepted === true });
      if (!accepted && this.open && session === this.session && revision === this.revision) this.hide('update-rejected');
    }).catch((error) => {
      browserHistoryLog('address.dispatch.failure', { revision, ...browserHistoryError(error) });
      if (this.open && session === this.session && revision === this.revision) { this.hide('update-failure'); this.error = true; }
    });
  }

  hide(reason = 'caller', notify = true): void {
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    this.suggestTimer = null; this.suggestSeq += 1;
    const wasOpen = this.open;
    if (wasOpen) browserHistoryLog('address.hide', { reason, revision: this.revision });
    this.open = false; this.entries = []; this.selectedIndex = -1; this.loading = false;
    if (notify && wasOpen) void popup.hide({ session: this.session }).catch((error) => browserHistoryLog('address.hide.failure', browserHistoryError(error)));
  }

  async action(action: BrowserHistoryPopupAction): Promise<void> {
    if (!this.open || action.session !== this.session || action.revision !== this.revision) return;
    if (action.action === 'next' || action.action === 'previous') { this.cycle(action.action === 'next' ? 1 : -1); return; }
    if (action.action === 'close') { this.hide('close'); return; }
    if (action.action === 'retry') { void this.focusInput(); this.schedule(this.query, false); return; }
    const url = action.url || this.candidateUrls[this.selectedIndex];
    if (!url || !this.candidateUrls.includes(url)) return;
    if (action.action === 'accept') {
      // 一条**历史记录**被接受 → 一律后台新 tab,不看当前 tab 的 `kind`
      // (Ral 2026-09-20,docs/features/history-row-opens-background-tab.md #3.1)。
      // 判据与下面 `remove` 用的是同一条:`candidateUrls` 是 `[googleUrl?, ...entries]`,
      // 只有落在 `entries` 里的才是存下来的历史记录,Google 候选行刻意留在老分支上。
      //
      // **判据是"点的是哪一行",不是 URL 文本。** 两类行的 URL 会重合:搜过一次 `cats`,
      // 结果页就被记进 browser_history;下次再输 `cats`,`candidateUrls` 的第 0 项(Google)
      // 与某条 entry 是**同一个字符串**,按 URL 分流会把 Google 行误判成历史记录行 ——
      // 当前 tab 不导航、Workbench 不收、地址栏被复位,#3.3 当场作废。
      // 所以鼠标点行由弹窗带 `row` 过来;键盘回车没有它,按 `selectedIndex` 推
      // (有查询词时第 0 项就是 Google 行)。两者都拿不到时才退回 URL 归属。
      //
      // **必须在 `hide()` 之前取。** `hide()` 会把 `entries` / `selectedIndex` 清空,之后再问
      // "这个 url 是不是一条历史记录"永远是 false —— 分支会静默地一次都不走,而所有既有断言照旧全绿。
      const isHistoryRow = (action.row ?? this.rowKindAt(action.url ? -1 : this.selectedIndex)
        ?? (this.entries.some((entry) => entry.url === url) ? 'history' : 'google')) === 'history';
      this.hide('accept');
      if (isHistoryRow) {
        // **不调 `backgroundWorkbenchTab()`。** 那是"切过去"的前置动作;这里人要留在当前页,
        // 把 Workbench 收掉只会露出**上一个**浏览器 tab,比什么都不发生更突兀。
        //
        // 复位排在 await 之前:当前 tab 不导航 → `coach/nav` 不播、`applyTabs` 的 id/url 判据
        // 也不成立,地址栏会留着刚才那串查询词而下面还是原来那一页(#3.2)。放在 await 之后
        // 还多一个竞态:人可以在开 tab 的空档里重新输入,那一下会被抹掉。
        this.restoreAddress?.();
        // 焦点交还 —— 与同一个 `action()` 里的 `remove` / `retry` 一致。**这一支原来漏了**,
        // 于是选完一条历史记录之后窗口里没有任何 webContents 持焦(见 `focusInput()` 的注释)。
        void this.focusInput();
        await coach.openTab({ url, background: true });
        return;
      }
      // Google 候选行:当前 tab 会真的导航过去,焦点归那一页,所以这里**不**抢回地址栏 ——
      // 导航本身把原生焦点交给操作区的 view,窗口不会落空。
      await coach.backgroundWorkbenchTab();
      const active = (await coach.getTabs()).find((tab) => tab.active);
      if (active?.kind === 'browser') await coach.navigate({ url });
      else await coach.openTab({ url });
    } else if (action.action === 'remove' && this.entries.some((entry) => entry.url === url)) {
      void this.focusInput();
      const session = this.session;
      const seq = ++this.suggestSeq;
      if (this.suggestTimer) clearTimeout(this.suggestTimer);
      this.suggestTimer = null;
      try {
        await history.remove({ url });
        if (this.open && session === this.session && seq === this.suggestSeq) this.schedule(this.query, false);
      } catch (error) {
        browserHistoryLog('address.remove.failure', browserHistoryError(error));
        if (this.open && session === this.session && seq === this.suggestSeq) { this.error = true; this.publish(); }
      }
    }
  }

  /**
   * 焦点交回地址栏 —— **原生焦点先回宿主页,再设 DOM 焦点**。
   *
   * 只 `input.focus()` 是不够的:弹窗是另一个 webContents,点过它之后原生焦点在它身上,而
   * `hide()` 会把它从窗口里摘掉 —— 焦点就落空了。那种状态下 DOM 焦点环画得出来,打字进不去,
   * 窗口里也没有任何 webContents 能收到 `before-input-event`(⌘W 因此落到菜单上关掉整扇窗,
   * Ral 2026-09-23)。
   *
   * 两步都在 `focusSuppressed` 之内:地址栏重新得到焦点会触发 `@focus` → `this.focus()`,
   * 而那正是「刚选完一行、下拉又弹开」的来路。
   */
  async focusInput(): Promise<void> {
    this.focusSuppressed = true;
    await popup.focusHost().catch(() => undefined);
    await nextTick(); this.input?.focus(); this.focusSuppressed = false;
  }

  private cycle(delta: number): void {
    const count = this.candidateUrls.length;
    if (count) this.selectedIndex = delta > 0 ? (this.selectedIndex + 1) % count : (this.selectedIndex < 0 ? count - 1 : (this.selectedIndex - 1 + count) % count);
    this.publish();
  }

  /** Returns true only for keys handled by suggestions; plain Enter retains existing navigation. */
  keydown(event: KeyboardEvent): boolean {
    if (this.composing || event.isComposing || event.keyCode === 229) return true;
    if (event.key === 'Escape' || event.key === 'Tab') {
      const wasOpen = this.open; this.hide(event.key === 'Escape' ? 'escape' : 'tab-key');
      if (wasOpen && event.key === 'Escape') event.preventDefault();
      return event.key === 'Escape';
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!this.open) this.focus();
      if (!this.open) return false;
      event.preventDefault(); this.cycle(event.key === 'ArrowDown' ? 1 : -1); return true;
    }
    if (event.key === 'Enter' && this.open && this.candidateUrls[this.selectedIndex]) {
      event.preventDefault();
      void this.action({ session: this.session, revision: this.revision, action: 'accept' }); return true;
    }
    return false;
  }
}

export const browserHistoryStore = reactive(new BrowserHistoryState());
