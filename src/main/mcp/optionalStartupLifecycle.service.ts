export type OptionalStartupStageGuard = () => boolean;

export class OptionalStartupLifecycle {
  private startupPromise: Promise<void> | null = null;
  private isFenced = false;

  start(operation: (canStartNextStage: OptionalStartupStageGuard) => Promise<void>): Promise<void> {
    if (this.startupPromise) return this.startupPromise;
    if (this.isFenced) {
      this.startupPromise = Promise.resolve();
      return this.startupPromise;
    }
    this.startupPromise = Promise.resolve().then(async () => {
      await operation(() => !this.isFenced);
    });
    return this.startupPromise;
  }

  async fenceAndJoin(): Promise<void> {
    this.isFenced = true;
    await this.startupPromise;
  }
}
