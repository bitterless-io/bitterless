export interface EyesOnAgentsWindowApi {
  openEyesOnAgentsWindow(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  getAlwaysOnTop(): Promise<boolean>;
  setAlwaysOnTop(params: { enable: boolean }): Promise<void>;
}

export interface EyesOnAgentsEnvApi {
  host: 'standalone' | 'omni';
}
