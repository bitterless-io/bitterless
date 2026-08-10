<template>
  <a-modal
    :visible="visible"
    :footer="false"
    :width="560"
    title-align="start"
    modal-class="mcp-guide-modal"
    @cancel="handleClose"
  >
    <template #title>
      <div class="mcp-guide__title">
        <div class="mcp-guide__eyebrow">{{ i18nHelper.todo.mcpEyebrow }}</div>
        <h2 class="mcp-guide__heading">{{ i18nHelper.todo.mcpTitle }}</h2>
      </div>
    </template>

    <div name="mcp-guide" class="mcp-guide">
      <a-alert
        v-if="info && info.serverName !== 'bitterless'"
        class="mcp-guide__instance-warning"
        type="warning"
        show-icon
        :title="i18nHelper.todo.mcpTestInstanceTitle.replace('{serverName}', info.serverName)"
      >
        {{ i18nHelper.todo.mcpTestInstanceWarning }}
      </a-alert>

      <div name="mcp-guide__complete-setup" class="mcp-guide__field mcp-guide__field--primary">
        <div class="mcp-guide__field-head">
          <span class="mcp-guide__field-title">{{ i18nHelper.todo.mcpCompleteSetup }}</span>
          <IconBtn
            class="mcp-guide__copy-button mcp-guide__copy-button--primary"
            :disabled="skillState.status !== 'ready' || !instruction"
            :title="i18nHelper.todo.mcpCopyCompleteSetup"
            :aria-label="i18nHelper.todo.mcpCopyCompleteSetup"
            @click="copyCompleteSetup"
          >
            <IconCopy class="mcp-guide__copy-icon" :size="18" stroke="1.8" />
          </IconBtn>
        </div>
        <p class="mcp-guide__hint">{{ i18nHelper.todo.mcpCompleteSetupHint }}</p>
        <a-alert
          v-if="skillState.status === 'restart-required'"
          class="mcp-guide__contract-error"
          type="error"
          show-icon
          :title="i18nHelper.todo.mcpRestartRequiredTitle"
        >
          {{ i18nHelper.todo.mcpRestartRequiredDescription }}
        </a-alert>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Message } from '@arco-design/web-vue';
import { IconCopy } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { McpIntegrationInfo } from '@shared/mcp/mcpBridge.type';
import { resolveMcpIntegrationSkillState } from '@shared/mcp/mcpIntegrationInfo.shared';
import { todoAgentSkillStore } from '../../store/todoAgentSkill.store';
import { TODO_AGENT_SKILL_VERSION_CODE } from '@shared/mcp/todoAgentSkillVersion.shared';

const props = defineProps<{
  visible: boolean;
  info: McpIntegrationInfo | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const handleClose = () => {
  emit('close');
};

const readRequiredText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const instruction = computed(() => readRequiredText(props.info?.instruction));
const skillState = computed(() =>
  resolveMcpIntegrationSkillState(props.info, TODO_AGENT_SKILL_VERSION_CODE),
);

const copyCompleteSetup = async (): Promise<void> => {
  if (!instruction.value || skillState.value.status !== 'ready') return;

  try {
    await navigator.clipboard.writeText(instruction.value);
  } catch {
    Message.error(i18nHelper.todo.mcpCopyFailed);
    return;
  }

  try {
    await todoAgentSkillStore.acknowledgeCurrentVersion(skillState.value.skillVersionCode);
    Message.success(i18nHelper.todo.mcpCopied);
  } catch {
    Message.error(i18nHelper.todo.mcpSkillAcknowledgementFailed);
  }
};
</script>

<style lang="less">
@import './McpGuideModal.less';
</style>
