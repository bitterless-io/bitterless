export interface OnlyPreviewOpenTrace {
  readonly tag: string;
  mark(fields: Record<string, unknown>): boolean;
  end(fields: Record<string, unknown>): boolean;
}

export interface OnlyPreviewOpenDiagnostics {
  emit(event: string, fields?: Record<string, unknown>): boolean;
  elapsed(startedAt: number): number;
  nextTag(prefix?: string): string;
  now(): number;
  trace(flow: 'window' | 'target' | 'preview', fields?: Record<string, unknown>, prefix?: string): OnlyPreviewOpenTrace;
}

export const createOnlyPreviewOpenDiagnostics: (options?: {
  clock?: () => number;
  write?: (line: string) => void;
}) => OnlyPreviewOpenDiagnostics;

export interface OnlyPreviewWindowOpenCoordinator {
  begin(route: 'api' | 'explicit', mode: 'existing' | 'cold'): OnlyPreviewOpenTrace;
  finish(tag: string, outcome: 'success' | 'failure' | 'timeout' | 'superseded', reason?: 'none' | 'fail' | 'closed' | 'load-fail' | 'render-gone' | 'unresponsive' | 'bootstrap-fail' | 'superseded' | 'diagnostic-timeout'): boolean;
  isActive(tag: string): boolean;
  mark(tag: string, fields: Record<string, unknown>): boolean;
  supersede(): boolean;
}

export const createOnlyPreviewWindowOpenCoordinator: (options: {
  diagnostics: OnlyPreviewOpenDiagnostics;
  timeoutMs?: number;
  setTimer?: (run: () => void, delay: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}) => OnlyPreviewWindowOpenCoordinator;
