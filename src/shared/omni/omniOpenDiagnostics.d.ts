export type OmniOpenRoute = 'api';
export type OmniOpenMode = 'cold' | 'existing';
export type OmniRendererDiagnosticRole = 'top' | 'browser' | 'control';
export type OmniRendererDiagnosticPhase =
  | 'renderer-script'
  | 'renderer-language'
  | 'renderer-import'
  | 'renderer-mount'
  | 'renderer-receipt'
  | 'layout-ready';

export interface OmniOpenDiagnosticTrace {
  readonly tag: string;
  mark(fields: Record<string, unknown>): boolean;
  end(fields: Record<string, unknown>): boolean;
}

export interface OmniOpenDiagnostics {
  emit(event: string, fields?: Record<string, unknown>): boolean;
  elapsed(startedAt: number): number;
  nextTag(prefix?: string): string;
  now(): number;
  trace(
    flow: 'open' | 'renderer' | 'navigation',
    startFields?: Record<string, unknown>,
    prefix?: string,
  ): OmniOpenDiagnosticTrace;
}

export interface OmniOpenDiagnosticsOptions {
  clock?: () => number;
  write?: (line: string) => void;
}

export function createOmniOpenDiagnostics(
  options?: OmniOpenDiagnosticsOptions,
): OmniOpenDiagnostics;
