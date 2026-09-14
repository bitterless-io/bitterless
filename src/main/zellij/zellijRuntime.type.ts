import type { ZellijSnapshot } from '@shared/zellij/zellij.type';
import type { ZellijConfigService } from './zellijConfig.service';

export interface ZellijChildProcessOptions {
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface ZellijOwnedProcess {
  stop(): Promise<void>;
  onExit(callback: () => void): void;
  exited(): boolean;
}

export interface ZellijRuntimeDependencies {
  config: ZellijConfigService;
  checkBinary(): void;
  /**
   * The port this build's server binds. Injected rather than read from a constant so the same class
   * serves every runtime profile — Production, Preview and the debug builds run side by side and
   * must not land on one port. See zellijPort.service.ts.
   */
  port(): number;
  run(args: string[]): Promise<string>;
  spawn(args: string[]): ZellijOwnedProcess;
  probe(): Promise<'absent' | 'matching' | 'mismatch' | 'occupied'>;
  login(token: string): Promise<boolean>;
  readToken(): string | null;
  writeToken(token: string): void;
  changed(snapshot: ZellijSnapshot): void;
  delay(milliseconds: number): Promise<void>;
}
