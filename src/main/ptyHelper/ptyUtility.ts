import * as pty from 'node-pty';
import { parentPort } from 'worker_threads';

interface PtySession {
  id: string;
  process: pty.IPty;
}

const sessions = new Map<string, PtySession>();

const handleMessage = (message: any): void => {
  const { type, sessionId, data } = message;

  switch (type) {
    case 'create': {
      const { shell, cols, rows, cwd } = data;
      const ptyProcess = pty.spawn(shell || process.env.SHELL || 'bash', [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: cwd || process.env.HOME,
        env: process.env as { [key: string]: string },
      });

      sessions.set(sessionId, { id: sessionId, process: ptyProcess });

      ptyProcess.onData((chunk) => {
        parentPort?.postMessage({
          type: 'data',
          sessionId,
          data: chunk,
        });
      });

      ptyProcess.onExit(({ exitCode }) => {
        parentPort?.postMessage({
          type: 'exit',
          sessionId,
          exitCode,
        });
        sessions.delete(sessionId);
      });

      parentPort?.postMessage({
        type: 'created',
        sessionId,
      });
      break;
    }

    case 'write': {
      const session = sessions.get(sessionId);
      if (session) {
        session.process.write(data.input);
      }
      break;
    }

    case 'resize': {
      const session = sessions.get(sessionId);
      if (session) {
        session.process.resize(data.cols, data.rows);
      }
      break;
    }

    case 'kill': {
      const session = sessions.get(sessionId);
      if (session) {
        session.process.kill();
        sessions.delete(sessionId);
      }
      break;
    }
  }
};

parentPort?.on('message', handleMessage);

console.log('[ptyUtility] started');
