import type { ElectronApplication } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DISPLAY_LABEL_ENV = 'BITTERLESS_E2E_DISPLAY_LABEL';

export const resolveE2ETargetDisplayLabel = (
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined => {
  const environmentLabel = env[DISPLAY_LABEL_ENV]?.trim();
  if (environmentLabel) return environmentLabel;

  const preferencePath = join(projectRoot, 'local', 'e2e-display-label');
  if (!existsSync(preferencePath)) return undefined;
  const [firstLine = ''] = readFileSync(preferencePath, 'utf8').split(/\r?\n/, 1);
  return firstLine.trim() || undefined;
};

interface ElectronDisplaySnapshot {
  availableDisplayLabels: string[];
  targetMatchCount: number;
  visibleWindows: Array<{
    title: string;
    displayLabel: string;
  }>;
}

const electronDisplaySnapshot = async (
  app: ElectronApplication,
  targetDisplayLabel: string
): Promise<ElectronDisplaySnapshot> =>
  await app.evaluate(({ BaseWindow, BrowserWindow, screen }, expectedLabel) => {
    const displays = screen.getAllDisplays();
    const windows = [...new Set([...BaseWindow.getAllWindows(), ...BrowserWindow.getAllWindows()])];
    return {
      availableDisplayLabels: displays.map((display) => display.label),
      targetMatchCount: displays.filter((display) => display.label === expectedLabel).length,
      visibleWindows: windows
        .filter((window) => window.isVisible())
        .map((window) => ({
          title: window.getTitle(),
          displayLabel: screen.getDisplayMatching(window.getBounds()).label
        }))
    };
  }, targetDisplayLabel);

const displayDiagnostic = (labels: readonly string[]): string =>
  labels.length ? labels.map((label) => JSON.stringify(label)).join(', ') : '(none)';

export const assertElectronTargetDisplayAvailable = async (
  app: ElectronApplication,
  targetDisplayLabel: string | undefined
): Promise<void> => {
  if (!targetDisplayLabel) return;
  const snapshot = await electronDisplaySnapshot(app, targetDisplayLabel);
  if (snapshot.targetMatchCount === 1) return;
  throw new Error(
    `E2E target display ${JSON.stringify(targetDisplayLabel)} must match exactly one display. ` +
      `Available display labels: ${displayDiagnostic(snapshot.availableDisplayLabels)}`
  );
};

export const assertVisibleWindowsOnTargetDisplay = async (
  app: ElectronApplication,
  targetDisplayLabel: string | undefined
): Promise<void> => {
  if (!targetDisplayLabel) return;
  const snapshot = await electronDisplaySnapshot(app, targetDisplayLabel);
  if (snapshot.targetMatchCount !== 1) {
    throw new Error(
      `E2E target display ${JSON.stringify(targetDisplayLabel)} must match exactly one display. ` +
        `Available display labels: ${displayDiagnostic(snapshot.availableDisplayLabels)}`
    );
  }
  if (!snapshot.visibleWindows.length) {
    throw new Error('E2E display assertion requires at least one visible top-level window.');
  }
  const mismatches = snapshot.visibleWindows.filter(
    (window) => window.displayLabel !== targetDisplayLabel
  );
  if (!mismatches.length) return;
  throw new Error(
    `Visible E2E windows are outside ${JSON.stringify(targetDisplayLabel)}: ` +
      mismatches
        .map(
          (window) => `${JSON.stringify(window.title)} on ${JSON.stringify(window.displayLabel)}`
        )
        .join(', ')
  );
};
