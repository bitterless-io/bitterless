export const APP_LANGUAGES = ['en', 'zh'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export interface ApplicationLanguageSnapshot {
  language: AppLanguage;
  revision: number;
}

export interface SetApplicationLanguageParams {
  language: AppLanguage;
}

export interface ApplicationLanguageApi {
  getCurrentLanguage(): Promise<ApplicationLanguageSnapshot>;
  setLanguage(params: SetApplicationLanguageParams): Promise<ApplicationLanguageSnapshot>;
}

export interface DurableLanguageApi {
  getLanguage(): Promise<unknown>;
  setLanguage(params: { lang: AppLanguage }): Promise<void>;
}

export interface ApplicationLanguagePersistence {
  read(): Promise<unknown>;
  write(language: AppLanguage): Promise<void>;
}

export interface ApplicationLanguageEffects {
  apply(language: AppLanguage): void;
  broadcast(snapshot: ApplicationLanguageSnapshot): void;
}

export type ApplicationLanguageErrorCode =
  | 'INVALID_APP_LANGUAGE'
  | 'INVALID_APP_LANGUAGE_SNAPSHOT'
  | 'APP_LANGUAGE_NOT_INITIALIZED'
  | 'APP_LANGUAGE_REVISION_CONFLICT';

export class ApplicationLanguageContractError extends Error {
  readonly code: ApplicationLanguageErrorCode;

  constructor(code: ApplicationLanguageErrorCode, message: string) {
    super(message);
    this.name = 'ApplicationLanguageContractError';
    this.code = code;
  }
}

export const isAppLanguage = (value: unknown): value is AppLanguage =>
  value === 'en' || value === 'zh';

export const parseAppLanguage = (value: unknown): AppLanguage => {
  if (!isAppLanguage(value)) {
    throw new ApplicationLanguageContractError(
      'INVALID_APP_LANGUAGE',
      `Expected application language "en" or "zh", received ${JSON.stringify(value)}`,
    );
  }
  return value;
};

export const resolveSystemAppLanguage = (value: unknown): AppLanguage => {
  if (typeof value !== 'string') return 'en';
  return /^zh(?:[-_]|$)/i.test(value.trim()) ? 'zh' : 'en';
};

export const parseApplicationLanguageSnapshot = (
  value: unknown,
): ApplicationLanguageSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationLanguageContractError(
      'INVALID_APP_LANGUAGE_SNAPSHOT',
      'Application language snapshot must be an object.',
    );
  }

  const candidate = value as { language?: unknown; revision?: unknown };
  if (!Number.isInteger(candidate.revision) || Number(candidate.revision) < 0) {
    throw new ApplicationLanguageContractError(
      'INVALID_APP_LANGUAGE_SNAPSHOT',
      `Application language revision must be a non-negative integer, received ${JSON.stringify(candidate.revision)}`,
    );
  }

  return {
    language: parseAppLanguage(candidate.language),
    revision: Number(candidate.revision),
  };
};

export class ApplicationLanguageCoordinator {
  private readonly persistence: ApplicationLanguagePersistence;
  private readonly effects: ApplicationLanguageEffects;
  private snapshot: ApplicationLanguageSnapshot | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private initializationPromise: Promise<ApplicationLanguageSnapshot> | null = null;
  private isPersistedInitialized = false;
  private stateVersion = 0;

  constructor(
    persistence: ApplicationLanguagePersistence,
    effects: ApplicationLanguageEffects,
  ) {
    this.persistence = persistence;
    this.effects = effects;
  }

  initializeFallback(value: unknown): ApplicationLanguageSnapshot {
    if (this.snapshot) return this.getSnapshot();
    const language = parseAppLanguage(value);
    this.snapshot = { language, revision: 0 };
    this.stateVersion += 1;
    this.effects.apply(language);
    return this.getSnapshot();
  }

  async initialize(): Promise<ApplicationLanguageSnapshot> {
    if (this.isPersistedInitialized) return this.getSnapshot();
    if (this.initializationPromise) return await this.initializationPromise;

    this.initializationPromise = this.initializePersistedLanguage();
    try {
      const snapshot = await this.initializationPromise;
      this.isPersistedInitialized = true;
      return snapshot;
    } finally {
      this.initializationPromise = null;
    }
  }

  getSnapshot(): ApplicationLanguageSnapshot {
    if (!this.snapshot) {
      throw new ApplicationLanguageContractError(
        'APP_LANGUAGE_NOT_INITIALIZED',
        'Application language has not been initialized.',
      );
    }
    return { ...this.snapshot };
  }

  async setLanguage(value: unknown): Promise<ApplicationLanguageSnapshot> {
    const language = parseAppLanguage(value);
    const pendingMutation = this.mutationQueue.then(() =>
      this.commitLanguage(language),
    );
    this.mutationQueue = pendingMutation.then(
      () => undefined,
      () => undefined,
    );
    return pendingMutation;
  }

  private async commitLanguage(
    language: AppLanguage,
  ): Promise<ApplicationLanguageSnapshot> {
    const current = this.getSnapshot();
    if (language === current.language && this.isPersistedInitialized) return current;

    await this.persistence.write(language);
    this.isPersistedInitialized = true;
    this.stateVersion += 1;

    const latest = this.getSnapshot();
    if (language === latest.language) return latest;

    const snapshot = {
      language,
      revision: latest.revision + 1,
    };
    this.snapshot = snapshot;
    this.stateVersion += 1;
    this.effects.apply(language);
    this.effects.broadcast(snapshot);
    return this.getSnapshot();
  }

  private async initializePersistedLanguage(): Promise<ApplicationLanguageSnapshot> {
    const versionBeforeRead = this.stateVersion;
    const language = parseAppLanguage(await this.persistence.read());
    if (this.stateVersion !== versionBeforeRead) return this.getSnapshot();

    if (!this.snapshot) {
      this.snapshot = { language, revision: 0 };
      this.stateVersion += 1;
      this.effects.apply(language);
      return this.getSnapshot();
    }

    const current = this.getSnapshot();
    if (language === current.language) return current;
    const snapshot = {
      language,
      revision: current.revision + 1,
    };
    this.snapshot = snapshot;
    this.stateVersion += 1;
    this.effects.apply(language);
    this.effects.broadcast(snapshot);
    return this.getSnapshot();
  }
}

export const APPLICATION_LANGUAGE_CHANGED_EVENT = 'language/changed';
