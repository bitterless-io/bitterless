// import { tool } from '@langchain/core/tools';
// import { z } from 'zod';
// // import { ptyEmitter } from '../../pty/pty.emitter';
//
// export const executeCommandSkill = tool(
//   async ({ command, cwd, timeout }: { command: string; cwd?: string; timeout?: number }) => {
//     console.log('[skill] execute_command, command:', command, 'cwd:', cwd);
//
//     try {
//       const result = await ptyEmitter.executeCommand({
//         command,
//         cwd,
//         timeout: timeout || 30000,
//       });
//
//       if (result.error) {
//         return JSON.stringify({
//           success: false,
//           error: result.error,
//           command,
//         });
//       }
//
//       return JSON.stringify({
//         success: true,
//         command,
//         output: result.output,
//         exitCode: result.exitCode,
//       });
//     } catch (err: any) {
//       console.error('[skill] execute_command error:', err.message);
//       return JSON.stringify({
//         success: false,
//         error: err.message,
//         command,
//       });
//     }
//   },
//   {
//     name: 'execute_command',
//     description:
//       'Execute a shell command on the user\'s system and return the output. ' +
//       'IMPORTANT: Only use this tool when the user explicitly asks you to run a command or perform a system operation that requires shell execution. ' +
//       'NEVER use this tool for tasks you can do yourself (e.g. calculations, text processing, code generation). ' +
//       'Always ask the user for confirmation before executing potentially destructive commands (e.g. rm, delete, format). ' +
//       'The command will be executed in a shell environment with a 30-second timeout by default. ' +
//       'Examples of valid use cases: ' +
//       '- User asks "check my git status" → command: "git status" ' +
//       '- User asks "list files in current directory" → command: "ls -la" ' +
//       '- User asks "what\'s my node version" → command: "node --version" ' +
//       'Examples of INVALID use cases (do NOT use this tool): ' +
//       '- User asks "what is 2+2" → answer directly, do NOT run "echo $((2+2))" ' +
//       '- User asks "generate a JSON file" → generate content directly, do NOT run "cat > file.json"',
//     schema: z.object({
//       command: z.string().describe(
//         'The shell command to execute. Use standard shell syntax. For multiple commands, separate with && or ;',
//       ),
//       cwd: z.string().optional().describe(
//         'Working directory for command execution. If not specified, uses user\'s home directory.',
//       ),
//       timeout: z.number().optional().describe(
//         'Timeout in milliseconds. Default is 30000 (30 seconds). Max is 60000 (60 seconds).',
//       ),
//     }),
//   },
// );
