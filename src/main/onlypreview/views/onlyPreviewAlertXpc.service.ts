import {
  parseOnlyPreviewAlertResolution,
  parseOnlyPreviewAlertSnapshotRequest
} from '@shared/onlypreview/onlyPreviewAlert.contract';
import type { OnlyPreviewAlertSnapshot } from '@shared/onlypreview/onlyPreviewAlert.types';
import { onlyPreviewHostRegistry } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewAlertViewService } from './onlyPreviewAlertView.service';

// The alert renderer's whole XPC surface. Every entry point re-validates its payload with the shared
// contract parser and asserts the host capability role before it reaches the view service, the same
// way Global Search does.
export class OnlyPreviewAlertXpcService {
  getSnapshot(value: unknown): OnlyPreviewAlertSnapshot {
    const request = parseOnlyPreviewAlertSnapshotRequest(value);
    const host = onlyPreviewHostRegistry.require(request.hostToken, ['content']);
    return onlyPreviewAlertViewService.snapshot(host.hostToken);
  }

  resolve(value: unknown): void {
    const resolution = parseOnlyPreviewAlertResolution(value);
    const host = onlyPreviewHostRegistry.require(resolution.hostToken, ['content']);
    onlyPreviewAlertViewService.resolve(host.hostToken, resolution);
  }
}

export const onlyPreviewAlertXpcService = new OnlyPreviewAlertXpcService();
