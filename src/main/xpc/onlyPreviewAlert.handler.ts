import { XpcMainHandler } from 'electron-xpc/main';
import {
  onlyPreviewSuccess,
  toOnlyPreviewErrorPayload
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewResult } from '@shared/onlypreview/onlyPreview.types';
import type {
  OnlyPreviewAlertApi,
  OnlyPreviewAlertResolution,
  OnlyPreviewAlertSnapshot,
  OnlyPreviewAlertSnapshotRequest
} from '@shared/onlypreview/onlyPreviewAlert.types';
import { onlyPreviewAlertXpcService } from '@main/onlypreview/views/onlyPreviewAlertXpc.service';
import { onlyPreviewLogService } from '@main/onlypreview/onlyPreviewLog.runtime';

// A handler class of its own rather than two more methods on `OnlyPreviewHandler`: that file is at
// its 800-line budget, and electron-xpc addresses handlers by class name, so a second class is the
// framework's own way to add a surface. `OnlyPreviewSearchRuntimeHandler` is the existing precedent.
const runAlertOperation = async <T>(
  operation: 'getAlertSnapshot' | 'resolveAlert',
  run: () => T
): Promise<OnlyPreviewResult<T>> => {
  try {
    return onlyPreviewSuccess(run());
  } catch (error) {
    const payload = toOnlyPreviewErrorPayload(error);
    onlyPreviewLogService.writeOperationFailure({ operation, code: payload.code, error });
    return { ok: false, error: payload };
  }
};

export class OnlyPreviewAlertHandler extends XpcMainHandler implements OnlyPreviewAlertApi {
  async getAlertSnapshot(
    params: OnlyPreviewAlertSnapshotRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewAlertSnapshot>> {
    return await runAlertOperation('getAlertSnapshot', () =>
      onlyPreviewAlertXpcService.getSnapshot(params)
    );
  }

  async resolveAlert(params: OnlyPreviewAlertResolution): Promise<OnlyPreviewResult<void>> {
    return await runAlertOperation('resolveAlert', () => {
      onlyPreviewAlertXpcService.resolve(params);
    });
  }
}

export const onlyPreviewAlertHandler = new OnlyPreviewAlertHandler();
