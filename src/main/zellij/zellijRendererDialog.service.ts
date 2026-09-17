import { dialog, type BaseWindow } from 'electron';

const owners = new WeakMap<BaseWindow, AbortSignal>();

/** Native fallback for a controls page that cannot render; never queues one modal per tab. */
export const promptZellijRendererRetry = async (
  owner: BaseWindow,
  labels: { title: string; message: string; retry: string; dismiss: string },
  signal: AbortSignal
): Promise<boolean> => {
  const previous = owners.get(owner);
  if (owner.isDestroyed() || signal.aborted || (previous && !previous.aborted)) return false;
  owners.set(owner, signal);
  try {
    const { response } = await dialog.showMessageBox(owner, {
      type: 'error',
      title: labels.title,
      message: labels.message,
      buttons: [labels.retry, labels.dismiss],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      signal
    });
    return response === 0 && !signal.aborted && !owner.isDestroyed();
  } catch {
    return false;
  } finally {
    if (owners.get(owner) === signal) owners.delete(owner);
  }
};
