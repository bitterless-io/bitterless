import type { WebContents } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { getOnlyPreviewAdapterSpec } from '@shared/onlypreview/onlyPreviewFind.registry';
import {
  ONLY_PREVIEW_FIND_COMMAND_EVENT,
  ONLY_PREVIEW_FIND_STATE_EVENT,
  type OnlyPreviewFindCommand,
  type OnlyPreviewFindCoverage,
  type OnlyPreviewFindIntent,
  type OnlyPreviewFindResult,
  type OnlyPreviewFindSnapshot,
  type OnlyPreviewFindState,
  type OnlyPreviewFindUnavailableReason,
  type OnlyPreviewPreviewPresentation,
  type OnlyPreviewPreviewSurface
} from '@shared/onlypreview/onlyPreview.types';

interface FindWebContentsTarget {
  webContents: WebContents;
  generation: number;
}

interface NativeFindRequest {
  webContents: WebContents;
  generation: number;
  requestId: number;
  selectionRevision: number;
  surface: OnlyPreviewPreviewSurface;
  findRevision: number;
}

interface ElectronFindResult {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

const COMPLETE_COVERAGE: OnlyPreviewFindCoverage = Object.freeze({ kind: 'complete' });

const unavailableReason = (
  presentation: OnlyPreviewPreviewPresentation
): OnlyPreviewFindUnavailableReason => {
  if (presentation.descriptor?.previewError?.code === 'TEXT_TOO_LARGE') return 'size-limit';
  if (presentation.adapterId === 'unsupported') return 'unsupported';
  if (presentation.status === 'unavailable' || presentation.error) return 'render-failed';
  return 'non-text';
};

const coverageEquals = (left: OnlyPreviewFindCoverage, right: OnlyPreviewFindCoverage): boolean =>
  left.kind === right.kind &&
  (left.kind === 'complete' ||
    (right.kind === 'partial' &&
      left.reason === right.reason &&
      left.acceptedSheets === right.acceptedSheets &&
      left.acceptedCells === right.acceptedCells));

const isElectronFindResult = (value: unknown): value is ElectronFindResult => {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(result.requestId) &&
    Number.isSafeInteger(result.activeMatchOrdinal) &&
    (result.activeMatchOrdinal as number) >= 0 &&
    Number.isSafeInteger(result.matches) &&
    (result.matches as number) >= 0 &&
    typeof result.finalUpdate === 'boolean'
  );
};

export class OnlyPreviewFindService {
  private presentation: OnlyPreviewPreviewPresentation | null = null;
  private findRevision = 0;
  private findOpen = false;
  private query = '';
  private caseSensitive = false;
  private result: OnlyPreviewFindResult | null = null;
  private state: OnlyPreviewFindState | null = null;
  private readyCoverage: OnlyPreviewFindCoverage | null = null;
  private pendingDirection: OnlyPreviewFindIntent['direction'] = 'forward';
  private pendingFindNext = true;
  private nativeRequest: NativeFindRequest | null = null;
  private runtimeFailure: {
    selectionRevision: number;
    surface: OnlyPreviewPreviewSurface;
  } | null = null;
  private readonly targets: Partial<Record<OnlyPreviewPreviewSurface, FindWebContentsTarget>> = {};

  reset(presentation: OnlyPreviewPreviewPresentation): void {
    this.stopEngines();
    this.presentation = presentation;
    this.findOpen = false;
    this.query = '';
    this.caseSensitive = false;
    this.result = null;
    this.readyCoverage = null;
    this.pendingDirection = 'forward';
    this.pendingFindNext = true;
    this.runtimeFailure = null;
    this.state = this.deriveState(presentation);
  }

  bindWebContents(
    surface: OnlyPreviewPreviewSurface,
    webContents: WebContents,
    generation: number
  ): void {
    this.targets[surface] = { webContents, generation };
    webContents.on('found-in-page', (_event, result) => {
      this.acceptNativeResult(webContents, generation, result);
    });
  }

  unbindWebContents(surface: OnlyPreviewPreviewSurface, webContents: WebContents): void {
    if (this.targets[surface]?.webContents === webContents) delete this.targets[surface];
    if (this.nativeRequest?.webContents === webContents) this.nativeRequest = null;
  }

  beginTransition(): void {
    this.findRevision += 1;
    this.stopEngines(true);
    this.findOpen = false;
    this.query = '';
    this.caseSensitive = false;
    this.result = null;
    this.readyCoverage = null;
    this.pendingDirection = 'forward';
    this.pendingFindNext = true;
    this.runtimeFailure = null;
  }

  syncPresentation(
    presentation: OnlyPreviewPreviewPresentation,
    readyCoverage?: OnlyPreviewFindCoverage
  ): void {
    const previousState = this.state;
    const previousPresentation = this.presentation;
    this.presentation = presentation;
    if (readyCoverage) this.readyCoverage = readyCoverage;
    this.state = this.deriveState(presentation);
    if (this.state.state === 'unavailable' && this.findOpen) {
      this.findRevision += 1;
      this.stopEngines(true);
      this.findOpen = false;
      this.query = '';
      this.caseSensitive = false;
      this.result = null;
      this.state = this.deriveState(presentation);
    }
    if (
      this.result &&
      (this.result.selectionRevision !== presentation.selectionRevision ||
        this.result.surface !== presentation.surface ||
        this.result.findRevision !== this.findRevision)
    ) {
      this.result = null;
    }
    this.publishState();
    const becameReadyFromCurrentPending =
      previousState?.state === 'pending' &&
      this.state.state === 'ready' &&
      previousPresentation?.selectionRevision === presentation.selectionRevision &&
      previousPresentation.surface === presentation.surface;
    if (becameReadyFromCurrentPending && this.findOpen && this.query) this.dispatchCurrent();
  }

  snapshot(): OnlyPreviewFindSnapshot {
    if (!this.state) {
      throw new OnlyPreviewContractError('HOST_NOT_FOUND', 'Preview find state is unavailable.');
    }
    return {
      state: { ...this.state },
      open: this.findOpen,
      query: this.query,
      caseSensitive: this.caseSensitive,
      result: this.result ? { ...this.result, coverage: { ...this.result.coverage } } : null
    };
  }

  open(): boolean {
    // The find bar is `v-if`-gated on this in the shell, so a refused open is indistinguishable from
    // a dead shortcut. `state=none` means no presentation has published a find capability at all.
    console.info(
      `[onlypreview] event=find-open state=${this.state?.state ?? 'none'} surface=${this.state?.surface ?? 'none'}`
    );
    if (!this.state || this.state.state === 'unavailable') {
      this.publishState();
      return false;
    }
    this.findOpen = true;
    this.publishState();
    return true;
  }

  submit(intent: Omit<OnlyPreviewFindIntent, 'hostToken'>): void {
    const presentation = this.requireCurrentPresentation(intent);
    if (!this.findOpen || !this.state || this.state.state === 'unavailable') {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Current Preview content does not have an open find session.'
      );
    }
    if (
      !intent.findNext &&
      (intent.query !== this.query || intent.caseSensitive !== this.caseSensitive)
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Find navigation cannot change the accepted query or case mode.'
      );
    }
    this.findRevision += 1;
    this.query = intent.query;
    this.caseSensitive = intent.caseSensitive;
    this.pendingDirection = intent.direction;
    this.pendingFindNext = intent.findNext;
    this.result = null;
    this.nativeRequest = null;
    this.state = this.deriveState(presentation);
    this.publishState();
    if (!this.query) {
      this.stopEngines(true);
      return;
    }
    if (this.state.state === 'ready') this.dispatchCurrent();
  }

  close(): void {
    const presentation = this.presentation;
    if (!presentation) return;
    this.findRevision += 1;
    this.findOpen = false;
    this.query = '';
    this.caseSensitive = false;
    this.result = null;
    this.pendingDirection = 'forward';
    this.pendingFindNext = true;
    this.stopEngines(true);
    this.state = this.deriveState(presentation);
    this.publishState();
  }

  isOpen(): boolean {
    return this.findOpen;
  }

  reportContentResult(result: OnlyPreviewFindResult): void {
    const presentation = this.presentation;
    const state = this.state;
    if (
      !presentation ||
      !state ||
      state.state !== 'ready' ||
      state.capability.mode !== 'content-adapter' ||
      !this.findOpen ||
      !this.query ||
      result.hostId !== presentation.hostId ||
      result.selectionRevision !== presentation.selectionRevision ||
      result.surface !== presentation.surface ||
      result.findRevision !== this.findRevision ||
      !coverageEquals(result.coverage, state.coverage)
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Preview find result belongs to a stale or incompatible adapter command.'
      );
    }
    this.result = { ...result, coverage: { ...result.coverage } };
    this.publishState();
  }

  private deriveState(presentation: OnlyPreviewPreviewPresentation): OnlyPreviewFindState {
    const identity = {
      hostId: presentation.hostId,
      selectionRevision: presentation.selectionRevision,
      surface: presentation.surface,
      findRevision: this.findRevision
    };
    if (
      this.runtimeFailure?.selectionRevision === presentation.selectionRevision &&
      this.runtimeFailure.surface === presentation.surface
    ) {
      return { ...identity, state: 'unavailable', reason: 'render-failed' };
    }
    if (presentation.status === 'loading' && !presentation.descriptor) {
      return { ...identity, state: 'pending' };
    }
    const spec = getOnlyPreviewAdapterSpec(presentation.adapterId);
    if (spec.surface !== presentation.surface || spec.find.mode === 'none') {
      return { ...identity, state: 'unavailable', reason: unavailableReason(presentation) };
    }
    if (presentation.status === 'loading') return { ...identity, state: 'pending' };
    if (presentation.status !== 'ready') {
      return { ...identity, state: 'unavailable', reason: unavailableReason(presentation) };
    }
    const coverage =
      spec.find.mode === 'content-adapter' ? this.readyCoverage : COMPLETE_COVERAGE;
    if (!coverage) return { ...identity, state: 'pending' };
    return {
      ...identity,
      state: 'ready',
      capability: spec.find,
      coverage
    };
  }

  private requireCurrentPresentation(
    intent: Omit<OnlyPreviewFindIntent, 'hostToken'>
  ): OnlyPreviewPreviewPresentation {
    const presentation = this.presentation;
    if (
      !presentation ||
      intent.selectionRevision !== presentation.selectionRevision ||
      intent.surface !== presentation.surface
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Preview find intent belongs to a stale selection.'
      );
    }
    return presentation;
  }

  private dispatchCurrent(): void {
    const presentation = this.presentation;
    const state = this.state;
    if (!presentation || !state || state.state !== 'ready' || !this.query) return;
    if (state.capability.mode === 'content-adapter') {
      xpcMain.broadcast(ONLY_PREVIEW_FIND_COMMAND_EVENT, {
        hostId: presentation.hostId,
        selectionRevision: presentation.selectionRevision,
        surface: presentation.surface,
        findRevision: this.findRevision,
        query: this.query,
        caseSensitive: this.caseSensitive,
        direction: this.pendingDirection,
        findNext: this.pendingFindNext,
        adapter: state.capability.adapter
      } satisfies OnlyPreviewFindCommand);
      return;
    }
    const target = this.targets[presentation.surface];
    if (!target || target.webContents.isDestroyed()) {
      console.info(`[onlypreview] event=find-dispatch surface=${presentation.surface} gate=no-target`);
      this.failRuntimeFind();
      return;
    }
    console.info(`[onlypreview] event=find-dispatch surface=${presentation.surface}`);
    let requestId: number;
    try {
      requestId = target.webContents.findInPage(this.query, {
        forward: this.pendingDirection === 'forward',
        findNext: this.pendingFindNext,
        matchCase: this.caseSensitive
      });
    } catch {
      this.failRuntimeFind();
      return;
    }
    this.nativeRequest = {
      webContents: target.webContents,
      generation: target.generation,
      requestId,
      selectionRevision: presentation.selectionRevision,
      surface: presentation.surface,
      findRevision: this.findRevision
    };
  }

  private acceptNativeResult(webContents: WebContents, generation: number, value: unknown): void {
    if (!isElectronFindResult(value)) return;
    // The answer to "does findInPage reach PDFium": a reply with matches proves it does. No query
    // text is recorded, only the count.
    console.info(`[onlypreview] event=find-result matches=${value.matches}`);
    const presentation = this.presentation;
    const state = this.state;
    const request = this.nativeRequest;
    const target = presentation ? this.targets[presentation.surface] : null;
    if (
      !presentation ||
      !state ||
      state.state !== 'ready' ||
      state.capability.mode !== 'webcontents-find' ||
      !request ||
      !target ||
      !this.findOpen ||
      !this.query ||
      request.webContents !== webContents ||
      request.generation !== generation ||
      request.requestId !== value.requestId ||
      target.webContents !== webContents ||
      target.generation !== generation ||
      request.selectionRevision !== presentation.selectionRevision ||
      request.surface !== presentation.surface ||
      request.findRevision !== this.findRevision
    ) {
      return;
    }
    if (
      value.matches === 0
        ? value.activeMatchOrdinal !== 0
        : value.activeMatchOrdinal < 1 || value.activeMatchOrdinal > value.matches
    ) {
      return;
    }
    this.result = {
      hostId: presentation.hostId,
      selectionRevision: presentation.selectionRevision,
      surface: presentation.surface,
      findRevision: this.findRevision,
      activeMatchOrdinal: value.activeMatchOrdinal,
      matches: value.matches,
      finalUpdate: value.finalUpdate,
      coverage: COMPLETE_COVERAGE
    };
    this.publishState();
  }

  private stopEngines(clearContentAdapter = false): void {
    this.nativeRequest = null;
    for (const target of Object.values(this.targets)) {
      if (!target || target.webContents.isDestroyed()) continue;
      try {
        target.webContents.stopFindInPage('clearSelection');
      } catch {
        // A selection transition can race the renderer teardown; the revision already fenced it.
      }
    }
    const presentation = this.presentation;
    if (!clearContentAdapter || !presentation) return;
    const spec = getOnlyPreviewAdapterSpec(presentation.adapterId);
    if (spec.find.mode !== 'content-adapter') return;
    xpcMain.broadcast(ONLY_PREVIEW_FIND_COMMAND_EVENT, {
      hostId: presentation.hostId,
      selectionRevision: presentation.selectionRevision,
      surface: presentation.surface,
      findRevision: this.findRevision,
      query: '',
      caseSensitive: this.caseSensitive,
      direction: 'forward',
      findNext: true,
      adapter: spec.find.adapter
    } satisfies OnlyPreviewFindCommand);
  }

  private failRuntimeFind(): void {
    const presentation = this.presentation;
    if (!presentation) return;
    this.findRevision += 1;
    this.stopEngines(true);
    this.runtimeFailure = {
      selectionRevision: presentation.selectionRevision,
      surface: presentation.surface
    };
    this.findOpen = false;
    this.query = '';
    this.result = null;
    this.state = {
      state: 'unavailable',
      hostId: presentation.hostId,
      selectionRevision: presentation.selectionRevision,
      surface: presentation.surface,
      findRevision: this.findRevision,
      reason: 'render-failed'
    };
    this.publishState();
  }

  private publishState(): void {
    if (!this.presentation) return;
    xpcMain.broadcast(ONLY_PREVIEW_FIND_STATE_EVENT, { hostId: this.presentation.hostId });
  }
}
