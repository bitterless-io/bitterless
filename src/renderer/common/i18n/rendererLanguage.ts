import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import {
  APPLICATION_LANGUAGE_CHANGED_EVENT,
  ApplicationLanguageContractError,
  parseAppLanguage,
  parseApplicationLanguageSnapshot,
  type AppLanguage,
  type ApplicationLanguageApi,
  type ApplicationLanguageSnapshot,
} from '@shared/i18n/applicationLanguage';
import { applyRendererLanguage } from './i18n.helper';

const applicationLanguage = createXpcRendererEmitter<ApplicationLanguageApi>(
  'ApplicationLanguageHandler',
);
const listeners = new Set<(language: AppLanguage) => void>();

let appliedSnapshot: ApplicationLanguageSnapshot | null = null;
let initializationPromise: Promise<ApplicationLanguageSnapshot> | null = null;

const applySnapshot = (value: unknown): ApplicationLanguageSnapshot => {
  const snapshot = parseApplicationLanguageSnapshot(value);
  if (appliedSnapshot) {
    if (snapshot.revision < appliedSnapshot.revision) return { ...appliedSnapshot };
    if (
      snapshot.revision === appliedSnapshot.revision &&
      snapshot.language !== appliedSnapshot.language
    ) {
      throw new ApplicationLanguageContractError(
        'APP_LANGUAGE_REVISION_CONFLICT',
        `Language revision ${snapshot.revision} changed from ${appliedSnapshot.language} to ${snapshot.language}.`,
      );
    }
    if (snapshot.revision === appliedSnapshot.revision) return { ...appliedSnapshot };
  }

  applyRendererLanguage(snapshot.language);
  appliedSnapshot = snapshot;
  for (const listener of listeners) listener(snapshot.language);
  return { ...snapshot };
};

const subscribeBeforeFetch = (): void => {
  xpcRenderer.subscribe(APPLICATION_LANGUAGE_CHANGED_EVENT, (payload) => {
    applySnapshot(payload.params);
  });
};

export const initializeRendererLanguage = (): Promise<ApplicationLanguageSnapshot> => {
  if (initializationPromise) return initializationPromise;

  subscribeBeforeFetch();
  initializationPromise = (async () => {
    const snapshot = await applicationLanguage.getCurrentLanguage();
    return applySnapshot(snapshot);
  })();
  return initializationPromise;
};

export const requestApplicationLanguageChange = async (
  value: unknown,
): Promise<ApplicationLanguageSnapshot> => {
  const language = parseAppLanguage(value);
  const snapshot = await applicationLanguage.setLanguage({ language });
  return applySnapshot(snapshot);
};

export const getCurrentRendererLanguage = (): AppLanguage => {
  if (!appliedSnapshot) {
    throw new ApplicationLanguageContractError(
      'APP_LANGUAGE_NOT_INITIALIZED',
      'Renderer language snapshot is unavailable before initialization.',
    );
  }
  return appliedSnapshot.language;
};

export const onRendererLanguageApplied = (
  listener: (language: AppLanguage) => void,
): (() => void) => {
  listeners.add(listener);
  if (appliedSnapshot) listener(appliedSnapshot.language);
  return () => listeners.delete(listener);
};
