// import { XpcMainHandler } from 'electron-xpc/main';
// import { ptyManager } from './ptyManager';
//
// export class PtyService extends XpcMainHandler {
//   async executeCommand(params: { command: string; cwd?: string; timeout?: number }): Promise<{ output: string; exitCode: number; error?: string }> {
//     try {
//       const result = await ptyManager.executeCommand(params.command, {
//         cwd: params.cwd,
//         timeout: params.timeout,
//       });
//       return result;
//     } catch (err: any) {
//       return {
//         output: '',
//         exitCode: -1,
//         error: err.message,
//       };
//     }
//   }
// }
