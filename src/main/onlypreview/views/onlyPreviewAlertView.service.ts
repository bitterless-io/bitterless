import { randomUUID } from 'node:crypto';
import type { BaseWindow, Rectangle, WebContents, WebContentsView } from 'electron';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { ONLY_PREVIEW_ALERT_STATE_EVENT } from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_ALERT_MAX_LISTED_ENTRIES,
  type OnlyPreviewAlertConfirmRequest,
  type OnlyPreviewAlertDialog,
  type OnlyPreviewAlertErrorDialog,
  type OnlyPreviewAlertErrorRequest,
  type OnlyPreviewAlertNewFolderRequest,
  type OnlyPreviewAlertResolution,
  type OnlyPreviewAlertSnapshot
} from '@shared/onlypreview/onlyPreviewAlert.types';
import {
  boundOnlyPreviewAlertLabel,
  boundOnlyPreviewAlertOptionalLabel,
  boundOnlyPreviewAlertText
} from '@shared/onlypreview/onlyPreviewAlert.contract';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';

export interface OnlyPreviewAlertViewRuntime {
  window: BaseWindow;
  host: OnlyPreviewHostCapability;
  createView: () => WebContentsView;
  loadView: (view: WebContentsView) => Promise<void>;
  broadcast: (eventName: string, params: unknown) => void;
  showInAlertLayer: (view: WebContentsView) => void;
  hideAlertLayer: () => void;
  focusedContents: () => WebContents | null;
}

// `error: null` is a failure with nothing the owner can act on — it closes the dialog instead of
// stacking a message. A populated `error` keeps the dialog open underneath it.
export type OnlyPreviewAlertCommitOutcome =
  | { ok: true }
  | { ok: false; error: OnlyPreviewAlertErrorRequest | null };

interface PendingDialog {
  dialogId: string;
  // Only the dialogs that write something have one. A confirmation settles on the owner's answer.
  commit?: (value: string) => Promise<OnlyPreviewAlertCommitOutcome>;
  settle: (confirmed: boolean) => void;
}

interface PendingError {
  dialogId: string;
  resolve: () => void;
}

const closeContentView = (view: WebContentsView | null): void => {
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.close();
  } catch {
    // The owning BaseWindow may already have destroyed the child.
  }
};

const sameBounds = (left: Rectangle, right: Rectangle): boolean =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

const cloneDialog = (dialog: OnlyPreviewAlertDialog | null): OnlyPreviewAlertDialog | null => {
  if (!dialog) return null;
  if (dialog.kind === 'new-folder') return { ...dialog };
  return { ...dialog, entries: dialog.entries.map((entry) => ({ ...entry })) };
};

export class OnlyPreviewAlertViewService {
  private runtime: OnlyPreviewAlertViewRuntime | null = null;
  private view: WebContentsView | null = null;
  private bounds: Rectangle | null = null;
  private loadGeneration = 0;
  // The alert view covers the whole window with a scrim, so an unloaded one is an invisible
  // click-and-keystroke sink over the shell and the preview. It stays out of the child list until
  // its page has loaded — the same rule Global Search follows.
  private ready = false;
  private revision = 0;
  private dialog: OnlyPreviewAlertDialog | null = null;
  private error: OnlyPreviewAlertErrorDialog | null = null;
  private pendingDialog: PendingDialog | null = null;
  private pendingError: PendingError | null = null;
  // Where focus was when the dialog opened, so closing it puts the caret back rather than dropping
  // the owner somewhere else in the window.
  private opener: WebContents | null = null;

  start(runtime: OnlyPreviewAlertViewRuntime): void {
    this.destroy();
    this.runtime = runtime;
  }

  isOpen(hostToken: string): boolean {
    return this.runtime?.host.hostToken === hostToken && this.hasVisibleDialog();
  }

  /**
   * Build the alert view before it is first needed.
   *
   * Owner rule for Global Search, and it applies identically here: spawning a renderer process is
   * the whole cost of the first dialog, so it is paid once at window open instead of on the
   * keystroke that asks for the dialog.
   */
  preload(hostToken: string): void {
    this.requireRuntime(hostToken);
    this.ensureView();
  }

  getView(): WebContentsView | null {
    return this.view;
  }

  updateBounds(hostToken: string, bounds: Rectangle): void {
    this.requireRuntime(hostToken);
    if (this.bounds && sameBounds(this.bounds, bounds)) return;
    this.bounds = { ...bounds };
    if (this.hasVisibleDialog()) this.attach();
  }

  snapshot(hostToken: string): OnlyPreviewAlertSnapshot {
    this.requireRuntime(hostToken);
    return {
      revision: this.revision,
      dialog: cloneDialog(this.dialog),
      error: this.error ? { ...this.error } : null
    };
  }

  /**
   * Collect a folder name, and keep the dialog open until the commit succeeds.
   *
   * `commit` is what makes the conflict message usable: on a rejected name the dialog stays on
   * screen with the typed name still in it and the error stacks above, so the next keystroke edits
   * the name instead of retyping it. Resolving the promise on the first Enter — and only then
   * creating — would close the dialog before the collision is known.
   */
  requestNewFolder(
    hostToken: string,
    request: OnlyPreviewAlertNewFolderRequest,
    commit: (name: string) => Promise<OnlyPreviewAlertCommitOutcome>
  ): Promise<boolean> {
    this.requireRuntime(hostToken);
    this.requireFreeDialogSlot();
    const dialog: OnlyPreviewAlertDialog = {
      kind: 'new-folder',
      dialogId: randomUUID(),
      title: boundOnlyPreviewAlertLabel(request.title, 'Alert title'),
      destinationLabel: boundOnlyPreviewAlertOptionalLabel(
        request.destinationLabel,
        'Alert destination'
      ),
      nameLabel: boundOnlyPreviewAlertLabel(request.nameLabel, 'Alert field label'),
      suggestedName: boundOnlyPreviewAlertOptionalLabel(request.suggestedName, 'Suggested name'),
      invalidNameMessage: boundOnlyPreviewAlertText(
        request.invalidNameMessage,
        'Alert name message'
      ),
      confirmLabel: boundOnlyPreviewAlertLabel(request.confirmLabel, 'Alert confirm label'),
      cancelLabel: boundOnlyPreviewAlertLabel(request.cancelLabel, 'Alert cancel label')
    };
    return new Promise<boolean>((settle) => {
      this.pendingDialog = { dialogId: dialog.dialogId, commit, settle };
      this.openDialog(dialog);
    });
  }

  requestConfirm(hostToken: string, request: OnlyPreviewAlertConfirmRequest): Promise<boolean> {
    this.requireRuntime(hostToken);
    this.requireFreeDialogSlot();
    const entries = request.entries.slice(0, ONLY_PREVIEW_ALERT_MAX_LISTED_ENTRIES);
    const dialog: OnlyPreviewAlertDialog = {
      kind: 'confirm',
      dialogId: randomUUID(),
      title: boundOnlyPreviewAlertLabel(request.title, 'Alert title'),
      message: boundOnlyPreviewAlertText(request.message, 'Alert message'),
      entries: entries.map((entry) => ({
        relativePath: boundOnlyPreviewAlertText(entry.relativePath, 'Alert entry'),
        nodeKind: entry.nodeKind
      })),
      moreLabel: boundOnlyPreviewAlertOptionalLabel(request.moreLabel, 'Alert more label'),
      folderTag: boundOnlyPreviewAlertOptionalLabel(request.folderTag, 'Alert folder tag'),
      confirmLabel: boundOnlyPreviewAlertLabel(request.confirmLabel, 'Alert confirm label'),
      cancelLabel: boundOnlyPreviewAlertLabel(request.cancelLabel, 'Alert cancel label'),
      confirmHint: boundOnlyPreviewAlertOptionalLabel(request.confirmHint, 'Alert confirm hint'),
      destructive: request.destructive === true
    };
    return new Promise<boolean>((settle) => {
      this.pendingDialog = { dialogId: dialog.dialogId, settle };
      this.openDialog(dialog);
    });
  }

  /**
   * The error surface, stacked above whatever raised it.
   *
   * It is not a second view: the layer manager allows one occupant per layer, so 「z-index 更高」is
   * literal CSS inside the one alert renderer. That is also what makes it reusable — a caller with
   * something to report needs no view, window or layer of its own.
   */
  showError(hostToken: string, request: OnlyPreviewAlertErrorRequest): Promise<void> {
    this.requireRuntime(hostToken);
    // A second error would hide the first, and the first is the one that explains what happened.
    if (this.pendingError) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'An alert error is already open.');
    }
    const dialog: OnlyPreviewAlertErrorDialog = {
      kind: 'error',
      dialogId: randomUUID(),
      title: boundOnlyPreviewAlertLabel(request.title, 'Alert title'),
      message: boundOnlyPreviewAlertText(request.message, 'Alert message'),
      confirmLabel: boundOnlyPreviewAlertLabel(request.confirmLabel, 'Alert confirm label')
    };
    return new Promise<void>((resolve) => {
      this.pendingError = { dialogId: dialog.dialogId, resolve };
      this.error = dialog;
      this.publish();
      this.present();
    });
  }

  async resolve(hostToken: string, resolution: OnlyPreviewAlertResolution): Promise<void> {
    this.requireRuntime(hostToken);
    // Matched against the visible error, not against a pending promise: an error raised by a failed
    // commit has no caller waiting on it, and it still has to be dismissible.
    if (this.error?.dialogId === resolution.dialogId) {
      const pending =
        this.pendingError?.dialogId === resolution.dialogId ? this.pendingError : null;
      if (pending) this.pendingError = null;
      this.error = null;
      this.publish();
      this.present();
      pending?.resolve();
      return;
    }
    if (this.pendingDialog?.dialogId !== resolution.dialogId) {
      // A resolution for a dialog Main no longer holds is not an error state — the window may have
      // closed under the renderer — but it must never resolve the current dialog.
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert dialog is unavailable.');
    }
    // An error stacked above the dialog owns the keyboard, so a resolution for the dialog underneath
    // it can only be stale.
    if (this.error) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'An alert error is still open.');
    }
    const pending = this.pendingDialog;
    if (resolution.outcome === 'cancel' || !pending.commit) {
      this.pendingDialog = null;
      this.dialog = null;
      this.publish();
      this.present();
      pending.settle(resolution.outcome === 'confirm');
      return;
    }
    // The renderer's call stays open across the commit, which is what keeps both of its buttons
    // disabled while the work runs — the dialog cannot be answered twice.
    const outcome = await pending.commit(resolution.value).catch(
      (): OnlyPreviewAlertCommitOutcome => ({
        ok: false,
        error: null
      })
    );
    if (this.pendingDialog !== pending) return;
    if (outcome.ok) {
      this.pendingDialog = null;
      this.dialog = null;
      this.publish();
      this.present();
      pending.settle(true);
      return;
    }
    if (!outcome.error) {
      // A failure with nothing to say still has to end the dialog rather than trap the owner in it.
      this.pendingDialog = null;
      this.dialog = null;
      this.publish();
      this.present();
      pending.settle(false);
      return;
    }
    this.error = {
      kind: 'error',
      dialogId: randomUUID(),
      title: boundOnlyPreviewAlertLabel(outcome.error.title, 'Alert title'),
      message: boundOnlyPreviewAlertText(outcome.error.message, 'Alert message'),
      confirmLabel: boundOnlyPreviewAlertLabel(outcome.error.confirmLabel, 'Alert confirm label')
    };
    // No pending error promise: this error belongs to the dialog underneath it, so dismissing it
    // returns to that dialog instead of resolving a caller.
    this.publish();
    this.present();
  }

  destroy(): void {
    const view = this.view;
    this.loadGeneration += 1;
    this.dialog = null;
    this.error = null;
    this.detach();
    this.view = null;
    this.ready = false;
    this.opener = null;
    closeContentView(view);
    this.runtime = null;
    this.bounds = null;
    this.revision = 0;
    this.cancelPending();
  }

  private openDialog(dialog: OnlyPreviewAlertDialog): void {
    this.dialog = dialog;
    this.publish();
    this.present();
  }

  private present(): void {
    const runtime = this.runtime;
    if (!runtime) return;
    if (!this.hasVisibleDialog()) {
      this.detach();
      this.restoreOpener();
      return;
    }
    if (!this.opener) this.opener = runtime.focusedContents();
    const view = this.ensureView();
    this.attach();
    if (view && !view.webContents.isDestroyed()) view.webContents.focus();
  }

  private restoreOpener(): void {
    const opener = this.opener;
    this.opener = null;
    if (!opener || opener.isDestroyed()) return;
    try {
      opener.focus();
    } catch {
      // The view that opened the dialog is gone; the window keeps whatever focus it has.
    }
  }

  private hasVisibleDialog(): boolean {
    return !!this.dialog || !!this.error;
  }

  private requireFreeDialogSlot(): void {
    if (this.pendingDialog) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'An alert dialog is already open.');
    }
  }

  private publish(): void {
    const runtime = this.runtime;
    this.revision += 1;
    if (!runtime) return;
    runtime.broadcast(ONLY_PREVIEW_ALERT_STATE_EVENT, {
      hostId: runtime.host.hostId,
      revision: this.revision
    });
  }

  private ensureView(): WebContentsView | null {
    const runtime = this.runtime;
    if (!runtime) return null;
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const view = runtime.createView();
    const generation = ++this.loadGeneration;
    this.view = view;
    this.ready = false;
    view.webContents.once('render-process-gone', () => {
      if (this.view !== view) return;
      this.failAlert(view);
    });
    const settle = (): void => {
      if (this.view !== view || generation !== this.loadGeneration) return;
      this.ready = true;
      if (!this.hasVisibleDialog()) return;
      this.attach();
      if (!view.webContents.isDestroyed()) view.webContents.focus();
    };
    void runtime
      .loadView(view)
      .then(settle)
      .catch(() => {
        if (this.view !== view || generation !== this.loadGeneration) return;
        this.failAlert(view);
      });
    return view;
  }

  private attach(): void {
    const runtime = this.runtime;
    const view = this.view;
    const bounds = this.bounds;
    // Naming which gate fired is the difference between "the dialog is behind the PDF" and "the
    // dialog was never attached". Global Search cost three rounds of z-order fixes without it.
    const gate = !this.hasVisibleDialog()
      ? 'closed'
      : !this.ready
        ? 'unloaded'
        : !runtime || runtime.window.isDestroyed()
          ? 'window'
          : !view || view.webContents.isDestroyed()
            ? 'view'
            : !bounds
              ? 'bounds'
              : null;
    if (gate) {
      console.info(`[onlypreview] event=alert-blocked gate=${gate}`);
      return;
    }
    if (!runtime || !view || !bounds) return;
    view.setBounds({ ...bounds });
    runtime.showInAlertLayer(view);
  }

  private detach(): void {
    const runtime = this.runtime;
    if (!runtime || runtime.window.isDestroyed() || !this.view) return;
    // Dropped from the sort and hidden, not torn down: the renderer survives a close so the next
    // dialog is instant.
    runtime.hideAlertLayer();
  }

  private failAlert(view: WebContentsView): void {
    if (this.view !== view) return;
    this.dialog = null;
    this.error = null;
    this.detach();
    this.view = null;
    this.ready = false;
    closeContentView(view);
    this.publish();
    this.restoreOpener();
    // A dialog whose renderer died has no answer. Cancelling is the only safe reading: no folder is
    // created, and nothing is deleted.
    this.cancelPending();
  }

  private cancelPending(): void {
    const dialog = this.pendingDialog;
    const error = this.pendingError;
    this.pendingDialog = null;
    this.pendingError = null;
    if (dialog) dialog.settle(false);
    if (error) error.resolve();
  }

  private requireRuntime(hostToken: string): OnlyPreviewAlertViewRuntime {
    const runtime = this.runtime;
    if (!runtime || runtime.host.hostToken !== hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'The alert layer does not belong to the active OnlyPreview host.'
      );
    }
    return runtime;
  }
}

export const onlyPreviewAlertViewService = new OnlyPreviewAlertViewService();
