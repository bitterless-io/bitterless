export class OnlyPreviewCharacterCountSourceGate {
  private currentRevision = '';
  private armedRevision = '';

  beginTransition(revision: string): boolean {
    if (!revision || revision === this.currentRevision) return false;
    this.currentRevision = revision;
    this.armedRevision = '';
    return true;
  }

  arm(revision: string): boolean {
    if (!this.isCurrent(revision)) return false;
    this.armedRevision = revision;
    return true;
  }

  disarm(revision: string): boolean {
    if (!this.isCurrent(revision)) return false;
    this.armedRevision = '';
    return true;
  }

  isCurrent(revision: string): boolean {
    return !!revision && revision === this.currentRevision;
  }

  canReport(revision: string, characterCount: number): boolean {
    if (!this.isCurrent(revision)) return false;
    return characterCount === 0 || this.armedRevision === revision;
  }
}

export class OnlyPreviewCharacterCountHostGate {
  private currentRevision = '';
  private readyRevision = '';
  private suspended = true;

  beginTransition(revision: string): boolean {
    if (!revision) return false;
    this.currentRevision = revision;
    this.readyRevision = '';
    this.suspended = true;
    return true;
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(revision: string): boolean {
    if (!revision || revision !== this.currentRevision) return false;
    this.suspended = false;
    return true;
  }

  acceptReady(revision: string): boolean {
    if (!revision || revision !== this.currentRevision) return false;
    this.readyRevision = revision;
    return true;
  }

  canAcceptCount(characterCount: number): boolean {
    return (
      characterCount === 0 ||
      (!this.suspended && !!this.currentRevision && this.readyRevision === this.currentRevision)
    );
  }

  canBufferCount(characterCount: number): boolean {
    return (
      characterCount > 0 &&
      this.suspended &&
      !!this.currentRevision &&
      this.readyRevision === this.currentRevision
    );
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  revisionForSync(): string {
    return this.currentRevision;
  }
}
