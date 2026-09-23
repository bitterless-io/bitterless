import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { ConfigApi } from '@maestro-shared/config.api';
import { DECISION_CONFIG_DOMAIN, DECISION_JEV_ENABLED_KEY } from '@maestro-shared/config.api';

// 与 capture 的 allowlist 开关同一张加密配置表,一行布尔不需要单独的主进程 handler
// (见 renderer/maestro/control/src/config/captureConfig.store.ts)。
const config = createXpcRendererEmitter<ConfigApi>('ConfigDao') as ConfigApi;

/**
 * Setting → Decision(Jev 开关)。插入点见 overmind
 * `areas/agent-runtime/decision/browser-use.html` #1。
 *
 * **不是存下来的 `true` 一律读成关。** electron-xpc 对「通道没注册」和「handler 抛了」都回 `null`,
 * 于是「配置库坏了」和「人把它关了」是同一个值。把那个默认成开,等于在配置库坏掉的那天
 * 把页面内容发给第三方 API。
 */
class DecisionSettingState {
  jevEnabled = false;
  loaded = false;
  busy = false;
  failed = false;

  async load(): Promise<void> {
    this.busy = true;
    try {
      const row = await config.get({
        domain: DECISION_CONFIG_DOMAIN,
        key: DECISION_JEV_ENABLED_KEY
      });
      this.jevEnabled = row?.options === true;
      this.failed = false;
    } catch (err) {
      console.error('[DecisionSettingState] Failed to read decision settings:', err);
      this.jevEnabled = false;
      this.failed = true;
    } finally {
      this.loaded = true;
      this.busy = false;
    }
  }

  /** 写落地了开关才留在人放的位置,否则弹回去。 */
  async setJevEnabled(next: boolean): Promise<void> {
    const previous = this.jevEnabled;
    this.jevEnabled = next;
    this.busy = true;
    try {
      const reply = await config.upsert({
        domain: DECISION_CONFIG_DOMAIN,
        key: DECISION_JEV_ENABLED_KEY,
        options: next
      });
      if (!reply?.ok) throw new Error('config upsert reported no ok');
      this.failed = false;
    } catch (err) {
      console.error('[DecisionSettingState] Failed to save decision settings:', err);
      this.jevEnabled = previous;
      this.failed = true;
    } finally {
      this.busy = false;
    }
  }
}

export const decisionSettingStore = reactive<DecisionSettingState>(new DecisionSettingState());
