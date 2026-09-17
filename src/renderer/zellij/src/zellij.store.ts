import { reactive } from 'vue';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  ZELLIJ_HANDLER_NAME,
  ZELLIJ_SURFACE_STATE_EVENT,
  ZELLIJ_SURFACE_QUERY,
  type ZellijApi,
  type ZellijErrorCode,
  type ZellijSnapshot
} from '@shared/zellij/zellij.type';

const api = createXpcRendererEmitter<ZellijApi>(ZELLIJ_HANDLER_NAME);

/**
 * Which surface this chrome belongs to, put on the URL by `ZellijSurface.load()`.
 *
 * Read once at module load: it is fixed for the life of the page, and every terminal geometry
 * message has to carry it or main cannot tell these interchangeable renderers apart.
 */
const SURFACE_ID = new URLSearchParams(window.location.search).get(ZELLIJ_SURFACE_QUERY) ?? '';

/**
 * Every catch here used to be a bare `catch {` that collapsed the real cause into the generic
 * 'operation-failed' code — so a failure showed one translated sentence and left no way to find out
 * what actually broke. The renderer console is captured into the application log file
 * (see src/main/logging/logPolicy.service.ts), so this reaches the log without DevTools open.
 */
const logZellijFailure = (code: string, error: unknown): void => {
  console.error(`[zellij] ${code}`, error);
};

class ZellijState {
  snapshot: ZellijSnapshot | null = null;
  initializing = false;
  error: ZellijErrorCode | null = null;

  get errorMessage(): string | null {
    const error = this.error ?? this.snapshot?.error;
    return error ? i18nHelper.zellij.errors[error] : null;
  }

  get statusLabel(): string {
    return i18nHelper.zellij.status[this.snapshot?.status ?? 'starting'];
  }

  get loadingLabel(): string {
    return this.snapshot?.status === 'reconnecting'
      ? i18nHelper.zellij.reconnecting
      : i18nHelper.zellij.opening;
  }

  get opening(): boolean {
    return !this.errorMessage && this.snapshot?.status !== 'ready';
  }

  apply(snapshot: ZellijSnapshot | null): void {
    if (
      !snapshot ||
      !['idle', 'starting', 'ready', 'reconnecting', 'error'].includes(snapshot.status) ||
      !snapshot.shortcuts
    ) {
      // A malformed snapshot looks identical to a thrown call from the UI, so say which one it was.
      logZellijFailure(
        'operation-failed',
        new Error(`malformed snapshot: ${JSON.stringify(snapshot)}`)
      );
      this.error = 'operation-failed';
      return;
    }
    this.snapshot = snapshot;
  }

  async load(): Promise<void> {
    this.error = null;
    try {
      this.apply(await api.snapshot({ surfaceId: SURFACE_ID }));
    } catch (error) {
      logZellijFailure('operation-failed', error);
      this.error = 'operation-failed';
    }
  }

  async initialize(): Promise<void> {
    if (this.initializing) return;
    this.initializing = true;
    this.error = null;
    if (this.snapshot?.status !== 'ready' && this.snapshot) {
      this.snapshot = { ...this.snapshot, status: 'starting', error: null };
    }
    try {
      this.apply(await api.initialize({ surfaceId: SURFACE_ID }));
    } catch (error) {
      logZellijFailure('operation-failed', error);
      this.error = 'operation-failed';
    } finally {
      this.initializing = false;
    }
  }

  async openSettings(): Promise<void> {
    try {
      await api.openSettings();
    } catch (error) {
      logZellijFailure('operation-failed', error);
      this.error = 'operation-failed';
    }
  }

  async setBounds(element: HTMLElement): Promise<void> {
    const rect = element.getBoundingClientRect();
    await api.setContentBounds({
      surfaceId: SURFACE_ID,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    });
  }
}

export const zellijStore = reactive<ZellijState>(new ZellijState());
xpcRenderer.subscribe(ZELLIJ_SURFACE_STATE_EVENT, (payload) => {
  const state = payload.params as { surfaceId: string; snapshot: ZellijSnapshot } | null;
  if (state?.surfaceId === SURFACE_ID) zellijStore.apply(state.snapshot);
});
