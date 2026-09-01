import { isAbsolute, resolve } from 'node:path';

const INTERNAL_SWITCH_PREFIXES = [
  '--mcp-',
  '--coding-agent-',
  '--inspect',
  '--remote-debugging-',
  '--user-data-dir=',
  '--enable-',
  '--disable-',
  '--allow-',
  '--no-'
] as const;

const SWITCHES_WITH_SEPARATE_VALUES = new Set([
  '--inspect',
  '--inspect-brk',
  '--inspect-port',
  '--remote-debugging-port',
  '--user-data-dir'
]);

const isInternalArgument = (value: string): boolean =>
  value.startsWith('-') || INTERNAL_SWITCH_PREFIXES.some((prefix) => value.startsWith(prefix));

export const resolveOnlyPreviewOpenTargets = (
  argv: readonly string[],
  options: {
    packaged: boolean;
    platform: NodeJS.Platform;
    workingDirectory?: string;
  }
): string[] => {
  const explicitPrefix = '--onlypreview-open=';
  const unique = new Set(
    argv
      .filter((value) => value.startsWith(explicitPrefix))
      .map((value) => value.slice(explicitPrefix.length))
      .filter((value) => isAbsolute(value))
  );
  if (!options.packaged) {
    return [...unique];
  }
  if (options.platform !== 'win32') return [...unique];
  const workingDirectory = options.workingDirectory;
  for (let index = 1; index < argv.length; index += 1) {
    const candidate = argv[index];
    if (!candidate) continue;
    if (isInternalArgument(candidate)) {
      if (!candidate.includes('=') && SWITCHES_WITH_SEPARATE_VALUES.has(candidate)) index += 1;
      continue;
    }
    const absoluteTarget = isAbsolute(candidate)
      ? candidate
      : workingDirectory && isAbsolute(workingDirectory)
        ? resolve(workingDirectory, candidate)
        : null;
    if (absoluteTarget) unique.add(absoluteTarget);
  }
  return [...unique];
};

export class OnlyPreviewTargetMutationQueue {
  private chain: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.chain.then(operation);
    this.chain = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }
}

export const serializeOnlyPreviewOpenTarget = (
  openTarget: (target: string) => Promise<void>,
  mutations = new OnlyPreviewTargetMutationQueue()
): ((target: string) => Promise<void>) => {
  return (target) => {
    return mutations.run(async () => await openTarget(target));
  };
};

export class OnlyPreviewOpenQueue {
  private ready = false;
  private readonly pending: string[] = [];
  private readonly pendingTargets = new Set<string>();
  private chain = Promise.resolve();

  constructor(private readonly openTarget: (target: string) => Promise<void>) {}

  enqueue(target: string): void {
    if (!isAbsolute(target) || this.pendingTargets.has(target)) return;
    this.pendingTargets.add(target);
    this.pending.push(target);
    this.flush();
  }

  markReady(): void {
    this.ready = true;
    this.flush();
  }

  private flush(): void {
    if (!this.ready) return;
    while (this.pending.length) {
      const target = this.pending.shift()!;
      this.pendingTargets.delete(target);
      this.chain = this.chain
        .then(async () => await this.openTarget(target))
        .catch(() => {
          console.warn('[OnlyPreview] A queued operating-system open request failed.');
        });
    }
  }
}
