// import { utilityProcess } from 'electron';
// import * as path from 'path';
// import type { UtilityProcess } from 'electron';
//
// interface PtySessionInfo {
//   id: string;
//   onData: (data: string) => void;
//   onExit: (exitCode: number) => void;
// }
//
// class PtyManager {
//   private utilityProc: UtilityProcess | null = null;
//   private sessions = new Map<string, PtySessionInfo>();
//   private isReady = false;
//   private readyCallbacks: Array<() => void> = [];
//
//   async init(): Promise<void> {
//     if (this.utilityProc) return;
//
//     const utilityPath = path.join(__dirname, 'ptyUtility.js');
//     console.log('[ptyManager] spawning utility process:', utilityPath);
//
//     this.utilityProc = utilityProcess.fork(utilityPath);
//
//     this.utilityProc.on('message', (message: any) => {
//       this.handleUtilityMessage(message);
//     });
//
//     this.utilityProc.on('exit', (code) => {
//       console.log('[ptyManager] utility process exited:', code);
//       this.utilityProc = null;
//       this.isReady = false;
//       this.sessions.clear();
//     });
//
//     this.isReady = true;
//     this.readyCallbacks.forEach((cb) => cb());
//     this.readyCallbacks = [];
//   }
//
//   private handleUtilityMessage(message: any): void {
//     const { type, sessionId, data, exitCode } = message;
//
//     switch (type) {
//       case 'created':
//         console.log('[ptyManager] session created:', sessionId);
//         break;
//
//       case 'data': {
//         const session = this.sessions.get(sessionId);
//         if (session) {
//           session.onData(data);
//         }
//         break;
//       }
//
//       case 'exit': {
//         const session = this.sessions.get(sessionId);
//         if (session) {
//           session.onExit(exitCode || 0);
//           this.sessions.delete(sessionId);
//         }
//         break;
//       }
//     }
//   }
//
//   private waitReady(): Promise<void> {
//     if (this.isReady) return Promise.resolve();
//     return new Promise((resolve) => {
//       this.readyCallbacks.push(resolve);
//     });
//   }
//
//   async createSession(
//     sessionId: string,
//     options: {
//       shell?: string;
//       cols?: number;
//       rows?: number;
//       cwd?: string;
//       onData: (data: string) => void;
//       onExit: (exitCode: number) => void;
//     },
//   ): Promise<void> {
//     await this.waitReady();
//
//     this.sessions.set(sessionId, {
//       id: sessionId,
//       onData: options.onData,
//       onExit: options.onExit,
//     });
//
//     this.utilityProc?.postMessage({
//       type: 'create',
//       sessionId,
//       data: {
//         shell: options.shell,
//         cols: options.cols,
//         rows: options.rows,
//         cwd: options.cwd,
//       },
//     });
//   }
//
//   async writeToSession(sessionId: string, input: string): Promise<void> {
//     await this.waitReady();
//     this.utilityProc?.postMessage({
//       type: 'write',
//       sessionId,
//       data: { input },
//     });
//   }
//
//   async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
//     await this.waitReady();
//     this.utilityProc?.postMessage({
//       type: 'resize',
//       sessionId,
//       data: { cols, rows },
//     });
//   }
//
//   async killSession(sessionId: string): Promise<void> {
//     await this.waitReady();
//     this.utilityProc?.postMessage({
//       type: 'kill',
//       sessionId,
//     });
//     this.sessions.delete(sessionId);
//   }
//
//   async executeCommand(command: string, options?: { cwd?: string; timeout?: number }): Promise<{ output: string; exitCode: number }> {
//     const sessionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
//     let output = '';
//     let exitCode = 0;
//     const timeout = options?.timeout || 30000;
//
//     return new Promise((resolve, reject) => {
//       const timer = setTimeout(() => {
//         this.killSession(sessionId);
//         reject(new Error(`Command timeout after ${timeout}ms`));
//       }, timeout);
//
//       this.createSession(sessionId, {
//         cwd: options?.cwd,
//         onData: (data) => {
//           output += data;
//         },
//         onExit: (code) => {
//           clearTimeout(timer);
//           exitCode = code;
//           resolve({ output, exitCode });
//         },
//       });
//
//       setTimeout(() => {
//         this.writeToSession(sessionId, `${command}\nexit\n`);
//       }, 100);
//     });
//   }
// }
//
// export const ptyManager = new PtyManager();
