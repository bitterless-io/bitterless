import { BaseWindow, dialog, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron';
import { i18nHelper } from '../i18n/i18n.helper';
import { selectDialogParent } from './dialogParent.service';

const resolveDialogParent = (): BaseWindow | null =>
  selectDialogParent(BaseWindow.getFocusedWindow(), BaseWindow.getAllWindows());

const showMessageBoxWithResolvedParent = async (
  options: MessageBoxOptions
): Promise<MessageBoxReturnValue> => {
  const owner = resolveDialogParent();
  return owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
};

class DialogHelper {
  async showKeychainAccessDeniedDialog(): Promise<void> {
    const messages = i18nHelper.getMessages();

    const options = {
      type: 'warning' as const,
      title: messages.app.keychainDeniedTitle,
      message: messages.app.keychainDeniedMessage,
      buttons: [messages.app.keychainDeniedCancel, messages.app.keychainDeniedOk],
      defaultId: 0,
      cancelId: 0,
    };

    await showMessageBoxWithResolvedParent(options);
  }

  async showQuitConfirmDialog(): Promise<boolean> {
    const messages = i18nHelper.getMessages();
    const platform = process.platform;
    
    const options = {
      type: 'question' as const,
      title: messages.app.quitConfirmTitle,
      message: messages.app.quitConfirmMessage,
      buttons: platform === 'darwin' 
        ? [messages.app.quitConfirmCancel, messages.app.quitConfirmOk]
        : [messages.app.quitConfirmOk, messages.app.quitConfirmCancel],
      defaultId: platform === 'darwin' ? 1 : 0,
      cancelId: platform === 'darwin' ? 0 : 1,
    };
    
    const result = await showMessageBoxWithResolvedParent(options);
    
    return platform === 'darwin' ? result.response === 1 : result.response === 0;
  }
}

export const dialogHelper = new DialogHelper();
