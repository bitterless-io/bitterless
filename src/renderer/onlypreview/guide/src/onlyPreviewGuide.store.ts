import { reactive } from 'vue';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import {
  isOnlyPreviewMcpServerKind,
  type OnlyPreviewAgentSkillGuideInfo
} from '@shared/onlypreview/onlyPreview.types';
import {
  isOnlyPreviewAgentSkillVersionCode,
  ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE
} from '@shared/onlypreview/onlyPreviewAgentSkillVersion.shared';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewGuideClient } from './onlyPreviewGuide.client';

type OnlyPreviewGuideStatus = 'pending' | 'ready' | 'restart-required';
type OnlyPreviewGuideFeedback = '' | 'copied' | 'copy-failed';

/**
 * 渲染层接受的**精确形状**,按字母序排列。
 *
 * 声明成一份具名常量,是因为 `onlyPreviewAgentSkill.test.mjs` 会断言它逐项等于 main 侧
 * `createOnlyPreviewAgentSkillGuideInfo` 实际产出的 key。2026-09-10 给契约加 `kind` 时只改了 main,
 * 这里还停在三键版本,于是每一个合法 payload 都被判为形状不符 —— Guide 对所有人恒显
 * restart-required,而重启永远修不好它。多余的 key 仍然拒:精确形状本身是这道校验的意义。
 */
const GUIDE_INFO_KEYS = ['instruction', 'kind', 'serverName', 'skillVersionCode'] as const;

const isExactGuideInfo = (value: unknown): value is OnlyPreviewAgentSkillGuideInfo => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== GUIDE_INFO_KEYS.join(',') ||
    typeof record.serverName !== 'string' ||
    record.serverName.trim().length === 0 ||
    !isOnlyPreviewMcpServerKind(record.kind) ||
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
