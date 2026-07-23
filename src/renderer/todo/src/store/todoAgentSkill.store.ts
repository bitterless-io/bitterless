import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  TODO_AGENT_SKILL_BASELINE_VERSION_CODE,
  TODO_AGENT_SKILL_LOADING_STATE,
  TODO_AGENT_SKILL_SETTING_KEY,
  TODO_AGENT_SKILL_SETTING_SUB_KEY,
  TODO_AGENT_SKILL_VERSION_CODE,
  TODO_AGENT_SKILL_VERSION_UPDATED_EVENT,
  resolveTodoAgentSkillVersionState,
  type TodoAgentSkillVersionState,
  type TodoAgentSkillVersionStatus,
} from '@shared/mcp/todoAgentSkillVersion.shared';
import { settingEmitter } from '../emitter/setting.emitter';

const MAX_ACKNOWLEDGEMENT_ATTEMPTS = 4;

class TodoAgentSkillState {
  versionState: TodoAgentSkillVersionState = { ...TODO_AGENT_SKILL_LOADING_STATE };

  get status(): TodoAgentSkillVersionStatus {
    return this.versionState.status;
  }

  get attention(): boolean {
    return this.versionState.attention;
  }

  async initialize(): Promise<void> {
    try {
      await settingEmitter.insertIfAbsent({
        key: TODO_AGENT_SKILL_SETTING_KEY,
        sub_key: TODO_AGENT_SKILL_SETTING_SUB_KEY,
        value: TODO_AGENT_SKILL_BASELINE_VERSION_CODE,
      });
      await this.refresh();
    } catch (error) {
      this.versionState = resolveTodoAgentSkillVersionState(null);
      throw error;
    }
  }

  async refresh(): Promise<void> {
    try {
      const stored = await settingEmitter.getStored({
        key: TODO_AGENT_SKILL_SETTING_KEY,
        sub_key: TODO_AGENT_SKILL_SETTING_SUB_KEY,
      });
      this.versionState = resolveTodoAgentSkillVersionState(
        stored.exists && stored.valid ? stored.value : null,
      );
    } catch (error) {
      this.versionState = resolveTodoAgentSkillVersionState(null);
      throw error;
    }
  }

  async acknowledgeCurrentVersion(versionCode: string): Promise<void> {
    if (versionCode !== TODO_AGENT_SKILL_VERSION_CODE) {
      throw new Error('[todo agent skill] integration version does not match this renderer');
    }

    for (let attempt = 0; attempt < MAX_ACKNOWLEDGEMENT_ATTEMPTS; attempt += 1) {
      const stored = await settingEmitter.getStored({
        key: TODO_AGENT_SKILL_SETTING_KEY,
        sub_key: TODO_AGENT_SKILL_SETTING_SUB_KEY,
      });
      const state = resolveTodoAgentSkillVersionState(
        stored.exists && stored.valid ? stored.value : null,
      );
      this.versionState = state;

      if (state.status === 'future' || state.status === 'current') return;
      if (!stored.exists) {
        await settingEmitter.insertIfAbsent({
          key: TODO_AGENT_SKILL_SETTING_KEY,
          sub_key: TODO_AGENT_SKILL_SETTING_SUB_KEY,
          value: TODO_AGENT_SKILL_BASELINE_VERSION_CODE,
        });
        continue;
      }
      if (stored.serializedValue === null) continue;

      const acknowledged = await settingEmitter.compareAndSet({
        key: TODO_AGENT_SKILL_SETTING_KEY,
        sub_key: TODO_AGENT_SKILL_SETTING_SUB_KEY,
        expectedSerializedValue: stored.serializedValue,
        value: TODO_AGENT_SKILL_VERSION_CODE,
      });
      if (!acknowledged) continue;

      this.versionState = resolveTodoAgentSkillVersionState(TODO_AGENT_SKILL_VERSION_CODE);
      xpcRenderer.broadcast(TODO_AGENT_SKILL_VERSION_UPDATED_EVENT);
      return;
    }

    await this.refresh();
    if (this.status === 'current' || this.status === 'future') return;
    throw new Error('[todo agent skill] acknowledgement changed concurrently');
  }
}

export const todoAgentSkillStore = reactive(new TodoAgentSkillState()) as TodoAgentSkillState;
