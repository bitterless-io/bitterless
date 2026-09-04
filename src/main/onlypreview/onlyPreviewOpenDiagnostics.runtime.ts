import { createOnlyPreviewOpenDiagnostics } from '@shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';
import { onlyPreviewLogService } from './onlyPreviewLog.runtime';
import { onlyPreviewProjectIndexStateService } from './onlyPreviewProjectIndexState.service';

export const onlyPreviewOpenDiagnostics = createOnlyPreviewOpenDiagnostics({
  write: (line) => onlyPreviewLogService.writeDiagnosticLine(line)
});

// Wired here rather than inside the service: the service is bundled for pure-Node tests and must
// stay free of the Electron log runtime.
onlyPreviewProjectIndexStateService.setTrace((event, fields) => {
  onlyPreviewOpenDiagnostics.emit(event, fields);
});
