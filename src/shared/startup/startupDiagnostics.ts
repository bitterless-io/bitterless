export const STARTUP_DIAGNOSTICS_CHANGED_EVENT = 'startup-diagnostics/changed';

export const STARTUP_DIAGNOSTIC_STAGES = [
  'core-sqlite',
  'trench-io',
  'application-language',
  'window-layout',
  'mcp-shim',
  'tray',
  'mcp-bridge',
  'eyes-on-agents',
] as const;

export type StartupDiagnosticStage = (typeof STARTUP_DIAGNOSTIC_STAGES)[number];

export interface StartupDiagnosticIssue {
  stage: StartupDiagnosticStage;
  message: string;
}

export interface StartupDiagnosticsSnapshot {
  revision: number;
  issues: StartupDiagnosticIssue[];
}

export interface StartupDiagnosticsApi {
  getStartupDiagnostics(): Promise<StartupDiagnosticsSnapshot>;
}

const isStartupDiagnosticStage = (value: unknown): value is StartupDiagnosticStage =>
  typeof value === 'string' &&
  (STARTUP_DIAGNOSTIC_STAGES as readonly string[]).includes(value);

export const parseStartupDiagnosticsSnapshot = (
  value: unknown,
): StartupDiagnosticsSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Startup diagnostics snapshot must be an object.');
  }

  const candidate = value as { revision?: unknown; issues?: unknown };
  if (!Number.isInteger(candidate.revision) || Number(candidate.revision) < 0) {
    throw new Error('Startup diagnostics revision must be a non-negative integer.');
  }
  if (!Array.isArray(candidate.issues)) {
    throw new Error('Startup diagnostics issues must be an array.');
  }

  const seenStages = new Set<StartupDiagnosticStage>();
  const issues = candidate.issues.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Startup diagnostic issue must be an object.');
    }
    const issue = value as { stage?: unknown; message?: unknown };
    if (!isStartupDiagnosticStage(issue.stage)) {
      throw new Error(`Unsupported startup diagnostic stage: ${String(issue.stage)}`);
    }
    if (seenStages.has(issue.stage)) {
      throw new Error(`Duplicate startup diagnostic stage: ${issue.stage}`);
    }
    if (typeof issue.message !== 'string' || !issue.message.trim()) {
      throw new Error(`Startup diagnostic message is required for ${issue.stage}.`);
    }
    seenStages.add(issue.stage);
    return {
      stage: issue.stage,
      message: issue.message,
    };
  });

  return {
    revision: Number(candidate.revision),
    issues,
  };
};

export class StartupDiagnosticsState {
  private snapshot: StartupDiagnosticsSnapshot = {
    revision: 0,
    issues: [],
  };

  getSnapshot(): StartupDiagnosticsSnapshot {
    return {
      revision: this.snapshot.revision,
      issues: this.snapshot.issues.map((issue) => ({ ...issue })),
    };
  }

  report(stage: StartupDiagnosticStage, message: string): StartupDiagnosticsSnapshot {
    const current = this.snapshot.issues.find((issue) => issue.stage === stage);
    if (current?.message === message) return this.getSnapshot();

    this.snapshot = {
      revision: this.snapshot.revision + 1,
      issues: [
        ...this.snapshot.issues.filter((issue) => issue.stage !== stage),
        { stage, message },
      ],
    };
    return this.getSnapshot();
  }

  clear(stage: StartupDiagnosticStage): StartupDiagnosticsSnapshot {
    if (!this.snapshot.issues.some((issue) => issue.stage === stage)) {
      return this.getSnapshot();
    }
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      issues: this.snapshot.issues.filter((issue) => issue.stage !== stage),
    };
    return this.getSnapshot();
  }
}

export const selectNewerStartupDiagnosticsSnapshot = (
  currentRevision: number,
  value: unknown,
): StartupDiagnosticsSnapshot | null => {
  const snapshot = parseStartupDiagnosticsSnapshot(value);
  return snapshot.revision > currentRevision ? snapshot : null;
};
