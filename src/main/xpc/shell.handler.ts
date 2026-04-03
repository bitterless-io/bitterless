import { XpcMainHandler } from 'electron-xpc/main';
import { shell } from 'electron';

export class ShellHandler extends XpcMainHandler {
  async openExternal(params: { url: string }): Promise<void> {
    await shell.openExternal(params.url);
  }
}

export const shellHandler = new ShellHandler();
