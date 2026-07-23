export interface TodoistSyncPasswordCapabilityApi {
  encryptPassword(params: { password: string }): Promise<string>;
  decryptPassword(params: { encrypted: string }): Promise<string>;
}

export interface TodoSystemApi {
  openDateTimeSettings(): Promise<void>;
}
