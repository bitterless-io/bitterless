import {
  ApplicationLanguageContractError,
  parseApplicationLanguageSnapshot,
  type ApplicationLanguageSnapshot,
} from '@shared/i18n/applicationLanguage';
import { applyRendererLanguage } from '@renderer/common/i18n/i18n.helper';

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
        `Coin language revision ${snapshot.revision} changed without advancing.`,
      );
    }
    if (snapshot.revision === appliedSnapshot.revision) return { ...appliedSnapshot };
  }

  applyRendererLanguage(snapshot.language);
  appliedSnapshot = snapshot;
  return { ...snapshot };
};

export const initializeCoinLanguage = (): Promise<ApplicationLanguageSnapshot> => {
  if (initializationPromise) return initializationPromise;

  window.coin.language.onChanged((snapshot) => applySnapshot(snapshot));
  initializationPromise = (async () =>
    applySnapshot(await window.coin.language.getCurrent()))();
  return initializationPromise;
};
