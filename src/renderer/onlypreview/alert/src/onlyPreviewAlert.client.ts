import { xpcRenderer } from 'electron-xpc/renderer';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import { ONLY_PREVIEW_ALERT_STATE_EVENT } from '@shared/onlypreview/onlyPreview.types';
import { parseOnlyPreviewAlertSnapshot } from '@shared/onlypreview/onlyPreviewAlert.contract';
import type {
  OnlyPreviewAlertApi,
  OnlyPreviewAlertSnapshot
} from '@shared/onlypreview/onlyPreviewAlert.types';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';

// Its own handler class rather than two more methods on `OnlyPreviewHandler`, which is at its
// 800-line budget. electron-xpc addresses a handler by class name, so the string must match
// `OnlyPreviewAlertHandler` exactly.
const alertEmitter = createXpcRendererEmitter<OnlyPreviewAlertApi>(
  'OnlyPreviewAlertHandler'
) as OnlyPreviewAlertApi;

interface AlertStateNudge {
  hostId: string;
  revision: number;
}

const isAlertStateNudge = (value: unknown): value is AlertStateNudge => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(event).length === 2 &&
    typeof event.hostId === 'string' &&
    Number.isSafeInteger(event.revision) &&
    (event.revision as number) >= 0
  );
};

export class OnlyPreviewAlertClient {
  private revision = -1;
  private subscribed = false;

  /**
   * The event carries only a revision; the state is pulled.
   *
   * A broadcast is fire-and-forget with no replay, and this renderer is created before any dialog
   * exists, so a pushed dialog could be sent while the page is still booting and would simply be
   * lost. Pulling on every nudge — and once on mount — is the only shape that cannot miss one.
   */
  subscribe(onSnapshot: (snapshot: OnlyPreviewAlertSnapshot) => void): void {
    if (this.subscribed) return;
    this.subscribed = true;
    const hostId = onlyPreviewEnv.hostId;
    if (!hostId) return;
    xpcRenderer.subscribe(ONLY_PREVIEW_ALERT_STATE_EVENT, ({ params }) => {
      if (!isAlertStateNudge(params) || params.hostId !== hostId) return;
      void this.refresh(onSnapshot);
    });
  }

  async refresh(onSnapshot: (snapshot: OnlyPreviewAlertSnapshot) => void): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const snapshot = parseOnlyPreviewAlertSnapshot(
      unwrapOnlyPreviewResult(await alertEmitter.getAlertSnapshot({ hostToken }))
    );
    // Out-of-order arrivals would otherwise reopen a dialog the owner just answered.
    if (snapshot.revision < this.revision) return;
    this.revision = snapshot.revision;
    onSnapshot(snapshot);
  }

  async resolve(dialogId: string, outcome: 'confirm' | 'cancel', value = ''): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    unwrapOnlyPreviewResult(
      await alertEmitter.resolveAlert({ hostToken, dialogId, outcome, value })
    );
  }
}

export const onlyPreviewAlertClient = new OnlyPreviewAlertClient();
