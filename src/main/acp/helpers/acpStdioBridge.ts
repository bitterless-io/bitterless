import { connectBridgeSocket } from './bridgeOptions';
import type { AcpBridgeOptions } from './bridgeOptions';

/** Raw bytes are preserved; Node pipe implements backpressure in both directions. */
export const runAcpStdioBridge = async (options: AcpBridgeOptions = {}): Promise<void> => {
  const socket = await connectBridgeSocket(options);
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let eofTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      if (eofTimer) clearTimeout(eofTimer);
      process.stdin.unpipe(socket);
      socket.unpipe(process.stdout);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      process.stdout.off('error', onError);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    const onEnd = (): void => { eofTimer = setTimeout(() => finish(), 2_000); };
    const onError = (error: Error): void => finish(error);
    const onSignal = (): void => finish();
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
    process.stdout.once('error', onError);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    socket.once('error', onError);
    socket.once('close', () => finish());
    process.stdin.pipe(socket);
    socket.pipe(process.stdout, { end: false });
  });
};
