import {
  parseOnlyPreviewGlobalSearchCloseRequest,
  parseOnlyPreviewGlobalSearchContextReportRequest,
  parseOnlyPreviewGlobalSearchDirectoryRevealCompletion,
  parseOnlyPreviewGlobalSearchDirectoryRevealRequest
} from '@shared/onlypreview/onlyPreview.contract';
import { onlyPreviewHostRegistry } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewGlobalSearchViewService } from './onlyPreviewGlobalSearchView.service';

export class OnlyPreviewGlobalSearchXpcService {
  reportContext(value: unknown): void {
    const request = parseOnlyPreviewGlobalSearchContextReportRequest(value);
    onlyPreviewHostRegistry.require(request.hostToken, ['content']);
    onlyPreviewGlobalSearchViewService.reportContext(request.hostToken, request.workspace);
  }

  getContext(hostToken: unknown) {
    const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
    return onlyPreviewGlobalSearchViewService.getContext(host.hostToken);
  }

  async revealDirectory(value: unknown): Promise<boolean> {
    const request = parseOnlyPreviewGlobalSearchDirectoryRevealRequest(value);
    onlyPreviewHostRegistry.require(request.hostToken, ['content']);
    return await onlyPreviewGlobalSearchViewService.requestDirectoryReveal(
      request.hostToken,
      request
    );
  }

  completeDirectoryReveal(value: unknown): void {
    const completion = parseOnlyPreviewGlobalSearchDirectoryRevealCompletion(value);
    onlyPreviewHostRegistry.require(completion.hostToken, ['content']);
    onlyPreviewGlobalSearchViewService.completeDirectoryReveal(
      completion.hostToken,
      completion
    );
  }

  close(value: unknown): boolean {
    const request = parseOnlyPreviewGlobalSearchCloseRequest(value);
    onlyPreviewHostRegistry.require(request.hostToken, ['content']);
    return onlyPreviewGlobalSearchViewService.close(request.hostToken, request.mode);
  }
}

export const onlyPreviewGlobalSearchXpcService = new OnlyPreviewGlobalSearchXpcService();
