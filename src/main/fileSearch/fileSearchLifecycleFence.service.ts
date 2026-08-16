export class FileSearchLifecycleFence {
  private settled = false;

  constructor(
    private readonly expectedUrl: string,
    private readonly onFailure: (message: string) => void
  ) {}

  acceptNavigation(url: string): boolean {
    if (!this.settled && url === this.expectedUrl) return true;
    this.fail('File-search renderer attempted an unexpected navigation.');
    return false;
  }

  fail(message: string): void {
    if (this.settled) return;
    this.settled = true;
    this.onFailure(message);
  }

  stop(): void {
    this.settled = true;
  }
}
