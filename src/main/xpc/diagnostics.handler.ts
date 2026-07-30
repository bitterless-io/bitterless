import { XpcMainHandler } from 'electron-xpc/main';
import type {
  ApplicationDiagnosticDirectoryKey,
  ApplicationDiagnosticsApi,
  ApplicationDiagnosticsOpenDirectoryResult,
  ApplicationDiagnosticsSnapshot
} from '@shared/diagnostics/applicationDiagnostics.contract';
import { applicationDiagnosticsService } from '@main/diagnostics/applicationDiagnostics.service';

export class DiagnosticsHandler extends XpcMainHandler implements ApplicationDiagnosticsApi {
  async getSnapshot(): Promise<ApplicationDiagnosticsSnapshot> {
    return await applicationDiagnosticsService.getSnapshot();
  }

  async revealLogFile(): Promise<ApplicationDiagnosticsOpenDirectoryResult> {
    return await applicationDiagnosticsService.revealLogFile();
  }

  async openDirectory(params: {
    key: ApplicationDiagnosticDirectoryKey;
  }): Promise<ApplicationDiagnosticsOpenDirectoryResult> {
    return await applicationDiagnosticsService.openDirectory(params);
  }
}

export const diagnosticsHandler = new DiagnosticsHandler();
