export type OmniOpenRoute = 'api';
export type OmniOpenMode = 'cold' | 'existing';
export type OmniOpenPhase = 'native' | 'restore' | 'first-visible' | 'interactive' | 'ready';
export type OmniOpenOutcome = 'success' | 'failure' | 'timeout' | 'superseded';
export type OmniOpenReason =
  | 'none'
  | 'create-fail'
  | 'load-fail'
  | 'unresponsive'
  | 'process-gone'
  | 'renderer-fail'
  | 'closed'
  | 'invalidated'
  | 'diagnostic-timeout';

export type OmniRendererDiagnosticRole = 'top' | 'browser' | 'control';
export type OmniRendererLifecyclePhase =
  | 'create'
  | 'load-start'
  | 'dom-ready'
  | 'load-finish'
  | 'load-fail'
  | 'unresponsive'
  | 'responsive'
  | 'process-gone';
export type OmniRendererBootstrapPhase =
  | 'renderer-script'
  | 'renderer-language'
  | 'renderer-import'
  | 'renderer-mount'
  | 'layout-ready';
export type OmniRendererDiagnosticPhase =
  | OmniRendererLifecyclePhase
  | OmniRendererBootstrapPhase;

export interface OmniOpenStartFields {
  route: OmniOpenRoute;
  mode: OmniOpenMode;
  generation: number;
}

export interface OmniOpenStageFields {
  phase: OmniOpenPhase;
  totalCount?: number;
  browserCount?: number;
  miniAppCount?: number;
  visible?: boolean;
  focused?: boolean;
}

export interface OmniOpenTerminalFields {
  outcome: OmniOpenOutcome;
  reason: OmniOpenReason;
  pendingTopLoad?: number;
  pendingTopMount?: number;
  pendingBrowserLoad?: number;
  pendingBrowserMount?: number;
}

export interface OmniRendererStartFields {
  parentTag?: string;
  role: OmniRendererDiagnosticRole;
  generation: number;
}

export interface OmniRendererStageFields {
  role: OmniRendererDiagnosticRole;
  phase: OmniRendererDiagnosticPhase;
  outcome: 'success' | 'failure';
  backgroundThrottling?: boolean;
}

export interface OmniRendererTerminalFields {
  role: OmniRendererDiagnosticRole;
  outcome: 'ready' | 'failure' | 'timeout' | 'superseded';
  reason:
    | 'none'
    | 'load-fail'
    | 'unresponsive'
    | 'process-gone'
    | 'renderer-fail'
    | 'invalidated'
    | 'diagnostic-timeout';
}

export interface OmniNavigationStartFields {
  parentTag?: string;
  generation: number;
}

export interface OmniNavigationStageFields {
  phase: 'scheduled' | 'start';
}

export interface OmniNavigationTerminalFields {
  outcome: 'success' | 'failure' | 'timeout' | 'superseded';
}

export interface OmniRendererReceiptFields {
  parentTag?: string;
  role: OmniRendererDiagnosticRole | 'unknown';
  outcome: 'accepted' | 'rejected';
}

export interface OmniOpenDiagnosticTrace<TStage, TTerminal> {
  readonly tag: string;
  mark(fields: TStage): boolean;
  end(fields: TTerminal): boolean;
}

export type OmniOpenTrace = OmniOpenDiagnosticTrace<
  OmniOpenStageFields,
  OmniOpenTerminalFields
>;
export type OmniRendererTrace = OmniOpenDiagnosticTrace<
  OmniRendererStageFields,
  OmniRendererTerminalFields
>;
export type OmniNavigationTrace = OmniOpenDiagnosticTrace<
  OmniNavigationStageFields,
  OmniNavigationTerminalFields
>;

export interface OmniOpenDiagnostics {
  elapsed(startedAt: number): number;
  nextTag(prefix?: string): string;
  now(): number;
  receipt(fields: OmniRendererReceiptFields): boolean;
  trace(flow: 'open', startFields: OmniOpenStartFields, prefix?: string): OmniOpenTrace;
  trace(
    flow: 'renderer',
    startFields: OmniRendererStartFields,
    prefix?: string,
  ): OmniRendererTrace;
  trace(
    flow: 'navigation',
    startFields: OmniNavigationStartFields,
    prefix?: string,
  ): OmniNavigationTrace;
}

export interface OmniOpenDiagnosticsOptions {
  clock?: () => number;
  write?: (line: string) => void;
}

export function createOmniOpenDiagnostics(
  options?: OmniOpenDiagnosticsOptions,
): OmniOpenDiagnostics;
