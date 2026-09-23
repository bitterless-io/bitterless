import { reactive } from 'vue';
import { homeShellBridge } from '@renderer/common/homeShellBridge.client';
class ChangePasswordState {
  password = '';
  confirmation = '';
  pending = false;
  saved = false;
  error: 'passwordPolicy' | 'passwordMismatch' | 'passwordFailed' | '' = '';
  reset(): void { this.password = ''; this.confirmation = ''; this.error = ''; this.saved = false; }
  async submit(): Promise<void> {
    if (this.pending) return;
    if (this.password.length < 8) { this.error = 'passwordPolicy'; return; }
    if (this.password !== this.confirmation) { this.error = 'passwordMismatch'; return; }
    this.pending = true; this.error = ''; this.saved = false;
    try {
      const result = await homeShellBridge.changePassword({ newPassword: this.password });
      if (!result.ok) throw new Error(result.error.message);
      this.reset();
      this.saved = true;
    } catch { this.error = 'passwordFailed'; }
    finally { this.pending = false; }
  }
}
export const changePasswordStore = reactive(new ChangePasswordState());
