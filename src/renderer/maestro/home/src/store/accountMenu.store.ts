import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { CoachXpcContract } from '@maestro-shared/coach.api';
import type { AccountMenuAction, AccountMenuParams } from '@shared/accountMenu';
import { homeShellBridge } from '@renderer/common/homeShellBridge.client';

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler');

class AccountMenuState {
  pending = false;
  error: 'openFailed' | 'logoutFailed' | '' = '';

  async show(params: AccountMenuParams): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.error = '';
    let action: AccountMenuAction | null = null;
    try {
      action = await coach.showAccountMenu(params);
      if (action === 'password') await coach.openAccountPassword();
      else if (action === 'logout') {
        await homeShellBridge.logout();
        await homeShellBridge.requestLogin();
      }
    } catch {
      this.error = action === 'logout' ? 'logoutFailed' : 'openFailed';
    } finally {
      this.pending = false;
    }
  }
}

export const accountMenuStore = reactive(new AccountMenuState());
