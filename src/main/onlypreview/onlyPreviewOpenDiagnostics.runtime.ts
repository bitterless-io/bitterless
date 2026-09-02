import { createOnlyPreviewOpenDiagnostics } from '@shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';
import { onlyPreviewLogService } from './onlyPreviewLog.runtime';

export const onlyPreviewOpenDiagnostics = createOnlyPreviewOpenDiagnostics({
  write: (line) => onlyPreviewLogService.writeDiagnosticLine(line)
});
