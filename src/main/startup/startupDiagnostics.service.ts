import { xpcMain } from 'electron-xpc/main';
import {
  STARTUP_DIAGNOSTICS_CHANGED_EVENT,
  StartupDiagnosticsState,
  type StartupDiagnosticStage,
  type StartupDiagnosticsSnapshot,
} from '@shared/startup/startupDiagnostics';

const errorMessage = (value: unknown): string => {
  const message = value instanceof Error ? value.message : String(value);
  return message.trim() || 'Unknown startup error';
};

class StartupDiagnosticsService {
  private readonly state = new StartupDiagnosticsState();

  getSnapshot(): StartupDiagnosticsSnapshot {
    return this.state.getSnapshot();
  }

  report(stage: StartupDiagnosticStage, error: unknown): StartupDiagnosticsSnapshot {
    const previousRevision = this.state.getSnapshot().revision;
    const snapshot = this.state.report(stage, errorMessage(error));
    if (snapshot.revision !== previousRevision) this.broadcast(snapshot);
    return snapshot;
  }

  clear(stage: StartupDiagnosticStage): StartupDiagnosticsSnapshot {
    const previousRevision = this.state.getSnapshot().revision;
    const snapshot = this.state.clear(stage);
    if (snapshot.revision !== previousRevision) this.broadcast(snapshot);
    return snapshot;
  }

  private broadcast(snapshot: StartupDiagnosticsSnapshot): void {
    xpcMain.broadcast(STARTUP_DIAGNOSTICS_CHANGED_EVENT, snapshot);
  }
}

export const startupDiagnosticsService = new StartupDiagnosticsService();
