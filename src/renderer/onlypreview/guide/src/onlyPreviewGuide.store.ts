import { reactive } from 'vue';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewAgentSkillGuideInfo } from '@shared/onlypreview/onlyPreview.types';
import {
  isOnlyPreviewAgentSkillVersionCode,
  ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE
} from '@shared/onlypreview/onlyPreviewAgentSkillVersion.shared';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewGuideClient } from './onlyPreviewGuide.client';

type OnlyPreviewGuideStatus = 'pending' | 'ready' | 'restart-required';
type OnlyPreviewGuideFeedback = '' | 'copied' | 'copy-failed';

const isExactGuideInfo = (value: unknown): value is OnlyPreviewAgentSkillGuideInfo => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'instruction,serverName,skillVersionCode' ||
    typeof record.serverName !== 'string' ||
    record.serverName.trim().length === 0 ||
    typeof record.instruction !== 'string' ||
    record.instruction.trim().length === 0 ||
    !isOnlyPreviewAgentSkillVersionCode(record.skillVersionCode)
  ) {
    return false;
  }
  return record.skillVersionCode === ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE;
};

class OnlyPreviewGuideStore {
  status: OnlyPreviewGuideStatus = 'pending';
  feedback: OnlyPreviewGuideFeedback = '';
  info: OnlyPreviewAgentSkillGuideInfo | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken || onlyPreviewEnv.mode !== 'guide') {
      this.status = 'restart-required';
      return;
    }
    try {
      const info = unwrapOnlyPreviewResult(
        await onlyPreviewGuideClient.getAgentSkillGuideInfo({ hostToken })
      );
      if (!isExactGuideInfo(info)) throw new Error('Guide contract mismatch');
      this.info = info;
      this.status = 'ready';
    } catch {
      this.info = null;
      this.status = 'restart-required';
    }
  }

  async copyCompleteSetup(): Promise<void> {
    if (this.status !== 'ready' || !this.info) return;
    this.feedback = '';
    try {
      await navigator.clipboard.writeText(this.info.instruction);
      this.feedback = 'copied';
    } catch {
      this.feedback = 'copy-failed';
    }
  }
}

export const onlyPreviewGuideStore = reactive<OnlyPreviewGuideStore>(
  new OnlyPreviewGuideStore()
);
