export interface TodoistSyncPasswordCapabilityApi {
  encryptPassword(params: {
    password: string;
    caller?: 'core-sqlite' | 'todoist-sync';
  }): Promise<string>;
  decryptPassword(params: {
    encrypted: string;
    caller?: 'core-sqlite' | 'todoist-sync';
  }): Promise<string>;
}

export interface TodoSystemApi {
  openDateTimeSettings(): Promise<void>;
}
