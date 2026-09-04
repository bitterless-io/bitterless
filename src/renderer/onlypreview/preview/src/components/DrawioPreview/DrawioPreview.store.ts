import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  renderOnlyPreviewDrawio,
  type OnlyPreviewDrawioContent,
  type OnlyPreviewDrawioViewerHandle
} from '../../onlyPreviewDrawio.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

export class DrawioPreviewStore {
  private viewerHandle: OnlyPreviewDrawioViewerHandle | null = null;
  private mountAbortController: AbortController | null = null;
  private generation = 0;

  async mount(
    element: HTMLElement,
    content: OnlyPreviewDrawioContent,
    reportingRevision: string
  ): Promise<void> {
    const generation = ++this.generation;
    this.mountAbortController?.abort();
    const abortController = new AbortController();
    this.mountAbortController = abortController;
    this.viewerHandle?.dispose();
    this.viewerHandle = null;
    const startedAt = Date.now();
    console.info(`[onlypreview] event=drawio-mount-start pages=${content.pageCount}`);
    try {
      const handle = await renderOnlyPreviewDrawio(element, content, {
        signal: abortController.signal
      });
      if (generation !== this.generation) {
        handle.dispose();
        console.info('[onlypreview] event=drawio-mount-superseded');
        return;
      }
      this.viewerHandle = handle;
      console.info(`[onlypreview] event=drawio-mount-ok elapsedMs=${Date.now() - startedAt}`);
      onlyPreviewPreviewStore.reportSurfaceReady(reportingRevision);
    } catch (error) {
      const code =
        error instanceof OnlyPreviewContractError ? error.code : 'DIAGRAM_PARSE_FAILED';
      // Logged before the report, not after: Main discards an observation whose revision has moved
      // on, and the code goes with it — which is why no diagram failure has ever reached the log.
      console.info(
        `[onlypreview] event=drawio-mount-failed code=${code} superseded=${generation !== this.generation} elapsedMs=${Date.now() - startedAt}`
      );
      if (generation !== this.generation) return;
      onlyPreviewPreviewStore.reportSurfaceError(reportingRevision, code);
    } finally {
      if (this.mountAbortController === abortController) this.mountAbortController = null;
    }
  }

  dispose(): void {
    this.generation += 1;
    this.mountAbortController?.abort();
    this.mountAbortController = null;
    this.viewerHandle?.dispose();
    this.viewerHandle = null;
  }
}
