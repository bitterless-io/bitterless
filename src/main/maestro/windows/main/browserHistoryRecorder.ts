import type { WebContents } from 'electron';
import type { BrowserHistoryApi } from '@maestro-shared/browserHistory.api';
import { normalizeBrowserHistoryUrl } from '@maestro-shared/browserHistory.service';

let lastWarningAt = 0;
const warnHistoryWrite = (): void => {
  if (Date.now() - lastWarningAt < 30_000) return;
  lastWarningAt = Date.now();
  console.warn('[maestro history] could not persist browser history');
};

/** Browser events cover both human and agent navigation; metadata events never count visits. */
export const bindBrowserHistoryRecorder = (wc: WebContents, options: {
  history: BrowserHistoryApi;
  isBrowser: () => boolean;
  dismiss: () => void;
}): void => {
  let successfulUrl: string | null = null;
  const current = (): string | null => wc.isDestroyed() ? null : normalizeBrowserHistoryUrl(wc.getURL());
  const update = (metadata: { title?: string; favicon?: string }): void => {
    if (!successfulUrl || !options.isBrowser() || current() !== successfulUrl) return;
    void options.history.updateMetadata({ url: successfulUrl, ...metadata }).catch(warnHistoryWrite);
  };
  wc.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (!isMainFrame) return;
    options.dismiss();
    if (!inPlace) successfulUrl = null;
  });
  wc.on('did-navigate', (_event, url, status) => {
    successfulUrl = null;
    if (!options.isBrowser() || status >= 400) return;
    successfulUrl = normalizeBrowserHistoryUrl(url);
    if (successfulUrl) void options.history.record({ url: successfulUrl }).catch(warnHistoryWrite);
  });
  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame || !successfulUrl || !options.isBrowser()) return;
    const next = normalizeBrowserHistoryUrl(url);
    if (!next || next === successfulUrl) return;
    successfulUrl = next;
    void options.history.record({ url: next, title: wc.getTitle() }).catch(warnHistoryWrite);
  });
  wc.on('page-title-updated', (_event, title) => update({ title }));
  wc.on('page-favicon-updated', (_event, favicons) => {
    if (favicons[0]) update({ favicon: favicons[0] });
  });
  wc.on('did-finish-load', () => update({ title: wc.getTitle() }));
  wc.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) successfulUrl = null;
  });
  wc.on('before-mouse-event', (_event, mouse) => {
    if (mouse.type === 'mouseDown') options.dismiss();
  });
  wc.on('focus', () => options.dismiss());
  wc.on('destroyed', () => { successfulUrl = null; options.dismiss(); });
};
