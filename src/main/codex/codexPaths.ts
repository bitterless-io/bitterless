import { join } from 'node:path';

export const codexAuthPath = (userDataRoot: string): string =>
  join(userDataRoot, 'cowork', 'pi', 'auth.json');

export const codexModelsPath = (userDataRoot: string): string =>
  join(userDataRoot, 'cowork', 'pi', 'models.json');

export const codexSettingsPath = (userDataRoot: string): string =>
  join(userDataRoot, 'cowork', 'pi', 'settings.json');
