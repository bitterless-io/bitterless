import { reactive } from 'vue';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewFindIntent,
  OnlyPreviewFindResult,
  OnlyPreviewFindSnapshot,
  OnlyPreviewFindState
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';

class OnlyPreviewFindStore {
  snapshot: OnlyPreviewFindSnapshot | null = null;
  query = '';
  caseSensitive = false;
  composing = false;
  focusRevision = 0;
  feedback = '';
  private fetchGeneration = 0;
  private pendingSubmissions = 0;
  private compositionCommitEcho: string | null = null;

  get state(): OnlyPreviewFindState | null {
    return this.snapshot?.state ?? null;
  }

  get result(): OnlyPreviewFindResult | null {
    return this.snapshot?.result ?? null;
  }

  get open(): boolean {
    return this.snapshot?.open === true;
  }

  get pending(): boolean {
    return this.state?.state === 'pending';
  }

  get ready(): boolean {
    return this.state?.state === 'ready';
  }

  get partial(): boolean {
    return this.state?.state === 'ready' && this.state.coverage.kind === 'partial';
  }

  async initialize(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const generation = ++this.fetchGeneration;
    try {
      const snapshot = unwrapOnlyPreviewResult(
        await onlyPreviewClient.getPreviewFindSnapshot({ hostToken })
      );
      if (generation !== this.fetchGeneration || snapshot.state.hostId !== onlyPreviewEnv.hostId) {
        return;
      }
      const previousSelection = this.snapshot?.state.selectionRevision;
      const previousSurface = this.snapshot?.state.surface;
      this.snapshot = snapshot;
      if (
        snapshot.open === false ||
        (previousSelection !== undefined &&
          (previousSelection !== snapshot.state.selectionRevision ||
            previousSurface !== snapshot.state.surface))
      ) {
        this.resetComposition();
      }
      if (!this.composing && this.pendingSubmissions === 0) {
        this.query = snapshot.query;
        this.caseSensitive = snapshot.caseSensitive;
      }
      if (
        previousSelection !== undefined &&
        previousSelection !== snapshot.state.selectionRevision
      ) {
        this.feedback = '';
      }
    } catch {
      if (generation === this.fetchGeneration) this.feedback = onlyPreviewI18n.preview.findFailed;
    }
  }

  async handleFocusRequest(): Promise<void> {
    await this.sync();
    if (this.open) {
      this.feedback = '';
      this.focusRevision += 1;
      return;
    }
    const reason = this.state?.state === 'unavailable' ? this.state.reason : 'unsupported';
    this.feedback =
      reason === 'size-limit'
        ? onlyPreviewI18n.preview.findSizeLimit
        : reason === 'render-failed'
          ? onlyPreviewI18n.preview.findRenderFailed
          : onlyPreviewI18n.preview.findUnavailable;
  }

  setQuery(value: string): void {
    this.compositionCommitEcho = null;
    this.query = this.normalizeQuery(value);
    void this.submit({ direction: 'forward', findNext: true });
  }

  beginComposition(): void {
    this.composing = true;
    this.compositionCommitEcho = null;
  }

  updateComposition(value: string): void {
    if (!this.composing) return;
    this.query = this.normalizeQuery(value);
  }

  endComposition(value: string): void {
    if (!this.composing) return;
    this.composing = false;
    this.query = this.normalizeQuery(value);
    this.compositionCommitEcho = this.query;
    void this.submit({ direction: 'forward', findNext: true });
  }

  acceptInput(value: string, isComposing: boolean): void {
    const normalized = this.normalizeQuery(value);
    if (this.composing || isComposing) {
      if (!this.composing) this.beginComposition();
      this.updateComposition(normalized);
      return;
    }
    if (this.compositionCommitEcho === normalized) {
      this.compositionCommitEcho = null;
      return;
    }
    this.setQuery(normalized);
  }

  toggleCaseSensitive(): void {
    if (this.composing) return;
    this.caseSensitive = !this.caseSensitive;
    void this.submit({ direction: 'forward', findNext: true });
  }

  next(): void {
    if (this.composing || !this.ready || !this.query) return;
    void this.submit({ direction: 'forward', findNext: false });
  }

  previous(): void {
    if (this.composing || !this.ready || !this.query) return;
    void this.submit({ direction: 'backward', findNext: false });
  }

  async close(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    this.fetchGeneration += 1;
    this.resetComposition();
    this.query = '';
    this.caseSensitive = false;
    this.feedback = '';
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.closePreviewFind({ hostToken }));
    } catch {
      this.feedback = onlyPreviewI18n.preview.findFailed;
    } finally {
      await this.sync();
    }
  }

  private async submit(
    navigation: Pick<OnlyPreviewFindIntent, 'direction' | 'findNext'>
  ): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const state = this.state;
    if (!hostToken || !state || state.state === 'unavailable' || !this.open) return;
    const intent: OnlyPreviewFindIntent = {
      hostToken,
      selectionRevision: state.selectionRevision,
      surface: state.surface,
      query: this.query,
      caseSensitive: this.caseSensitive,
      direction: navigation.direction,
      findNext: navigation.findNext
    };
    this.pendingSubmissions += 1;
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.submitPreviewFind(intent));
    } catch {
      this.feedback = onlyPreviewI18n.preview.findFailed;
    } finally {
      this.pendingSubmissions -= 1;
      await this.sync();
    }
  }

  private normalizeQuery(value: string): string {
    return value.slice(0, 4096);
  }

  private resetComposition(): void {
    this.composing = false;
    this.compositionCommitEcho = null;
  }
}

export const onlyPreviewFindStore = reactive<OnlyPreviewFindStore>(new OnlyPreviewFindStore());
