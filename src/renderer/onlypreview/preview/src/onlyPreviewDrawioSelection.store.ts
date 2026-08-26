import {
  OnlyPreviewDrawioSession,
  type OnlyPreviewDrawioContent
} from './onlyPreviewDrawio.service';

interface OnlyPreviewDrawioLoadAttempt {
  session: OnlyPreviewDrawioSession;
  result: Promise<OnlyPreviewDrawioContent>;
}

export class OnlyPreviewDrawioSelectionStore {
  private session: OnlyPreviewDrawioSession | null = null;

  start(
    hostId: string,
    selectionRevision: number,
    assetUrl: string,
    expectedSize: number
  ): OnlyPreviewDrawioLoadAttempt {
    this.dispose();
    const session = new OnlyPreviewDrawioSession({ hostId, selectionRevision });
    this.session = session;
    return { session, result: session.load(assetUrl, expectedSize) };
  }

  accept(attempt: OnlyPreviewDrawioLoadAttempt): boolean {
    return this.session === attempt.session;
  }

  cancel(attempt: OnlyPreviewDrawioLoadAttempt): void {
    attempt.session.dispose();
    if (this.session === attempt.session) this.session = null;
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }
}
