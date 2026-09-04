import { reactive } from 'vue';
import type {
  OnlyPreviewAlertConfirmDialog,
  OnlyPreviewAlertErrorDialog,
  OnlyPreviewAlertNewFolderDialog,
  OnlyPreviewAlertProgressDialog,
  OnlyPreviewAlertSnapshot
} from '@shared/onlypreview/onlyPreviewAlert.types';
import { onlyPreviewAlertClient } from './onlyPreviewAlert.client';
import {
  resolveOnlyPreviewAlertKey,
  resolveOnlyPreviewAlertKeyboardLayer,
  resolveOnlyPreviewAlertName,
  type OnlyPreviewAlertKeyInput,
  type OnlyPreviewAlertKeyboardLayer
} from './onlyPreviewAlert.service';

const EMPTY_SNAPSHOT: OnlyPreviewAlertSnapshot = { revision: 0, dialog: null, error: null };

class OnlyPreviewAlertStore {
  snapshot: OnlyPreviewAlertSnapshot = EMPTY_SNAPSHOT;
  draft = '';
  busy = false;
  // Bumped whenever a dialog appears, so the view can re-run its focus effect without watching a
  // whole object graph.
  focusRevision = 0;

  get newFolder(): OnlyPreviewAlertNewFolderDialog | null {
    const dialog = this.snapshot.dialog;
    return dialog && dialog.kind === 'new-folder' ? dialog : null;
  }

  get confirm(): OnlyPreviewAlertConfirmDialog | null {
    const dialog = this.snapshot.dialog;
    return dialog && dialog.kind === 'confirm' ? dialog : null;
  }

  /** Reports work in flight. Nothing here can answer it — Main opens, updates and closes it. */
  get progress(): OnlyPreviewAlertProgressDialog | null {
    const dialog = this.snapshot.dialog;
    return dialog && dialog.kind === 'progress' ? dialog : null;
  }

  get error(): OnlyPreviewAlertErrorDialog | null {
    return this.snapshot.error;
  }

  get keyboardLayer(): OnlyPreviewAlertKeyboardLayer {
    return resolveOnlyPreviewAlertKeyboardLayer(this.snapshot);
  }

  get nameValid(): boolean {
    return resolveOnlyPreviewAlertName(this.draft).ok;
  }

  // Nothing is said while the field is empty: an empty input is a starting state, not a mistake.
  get nameRejected(): boolean {
    return this.draft.trim().length > 0 && !this.nameValid;
  }

  async initialize(): Promise<void> {
    onlyPreviewAlertClient.subscribe((snapshot) => this.accept(snapshot));
    await onlyPreviewAlertClient.refresh((snapshot) => this.accept(snapshot));
  }

  updateDraft(draft: string): void {
    this.draft = draft;
  }

  handleKey(input: OnlyPreviewAlertKeyInput): boolean {
    const action = resolveOnlyPreviewAlertKey(this.keyboardLayer, input);
    if (action === 'none') return false;
    if (action === 'dismiss-error') {
      void this.dismissError();
      return true;
    }
    if (action === 'cancel') {
      void this.cancel();
      return true;
    }
    void this.commit();
    return true;
  }

  async commit(): Promise<void> {
    const dialog = this.snapshot.dialog;
    if (!dialog || this.snapshot.error || this.busy) return;
    if (dialog.kind === 'new-folder') {
      const name = resolveOnlyPreviewAlertName(this.draft);
      if (!name.ok) return;
      await this.resolve(dialog.dialogId, 'confirm', name.name);
      return;
    }
    await this.resolve(dialog.dialogId, 'confirm');
  }

  async cancel(): Promise<void> {
    const dialog = this.snapshot.dialog;
    if (!dialog || this.snapshot.error || this.busy) return;
    await this.resolve(dialog.dialogId, 'cancel');
  }

  async dismissError(): Promise<void> {
    const error = this.snapshot.error;
    if (!error || this.busy) return;
    await this.resolve(error.dialogId, 'confirm');
  }

  private async resolve(
    dialogId: string,
    outcome: 'confirm' | 'cancel',
    value = ''
  ): Promise<void> {
    this.busy = true;
    try {
      await onlyPreviewAlertClient.resolve(dialogId, outcome, value);
    } finally {
      this.busy = false;
    }
  }

  private accept(snapshot: OnlyPreviewAlertSnapshot): void {
    const previous = this.snapshot.dialog;
    const next = snapshot.dialog;
    this.snapshot = snapshot;
    // A new dialog seeds the field from Main's suggestion; a snapshot that only stacked or dropped
    // the error above the SAME dialog must keep what the owner has typed — that is what makes the
    // conflict error usable, because the rejected name is still there to edit.
    if (next && next.dialogId !== previous?.dialogId) {
      this.draft = next.kind === 'new-folder' ? next.suggestedName : '';
    }
    if (!next) this.draft = '';
    this.focusRevision += 1;
  }
}

export const onlyPreviewAlertStore = reactive(new OnlyPreviewAlertStore());
