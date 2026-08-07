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
  if (!options.packaged) {
    const prefix = '--onlypreview-open=';
    return [
      ...new Set(
        argv
          .filter((value) => value.startsWith(prefix))
          .map((value) => value.slice(prefix.length))
          .filter((value) => isAbsolute(value))
      )
    ];
  }
  if (options.platform !== 'win32') return [];
  const workingDirectory = options.workingDirectory;
  const unique = new Set<string>();
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
