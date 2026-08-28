export interface OnlyPreviewSearchDiagnostics {
  emit(event: string, fields?: Record<string, unknown>): boolean;
  elapsed(startedAt: number): number;
  nextTag(prefix?: string): string;
  now(): number;
}

export const createOnlyPreviewSearchDiagnostics: (options?: {
  clock?: () => number;
  write?: (line: string) => void;
}) => OnlyPreviewSearchDiagnostics;
