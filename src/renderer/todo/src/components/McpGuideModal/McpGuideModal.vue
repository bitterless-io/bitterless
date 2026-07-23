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
      <p class="mcp-guide__summary">{{ i18nHelper.todo.mcpSummary }}</p>

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
      </div>

      <h3 class="mcp-guide__details-title">{{ i18nHelper.todo.mcpDetailedInstructions }}</h3>

      <section name="mcp-guide__mcp-step" class="mcp-guide__step">
        <div class="mcp-guide__step-head">
          <span class="mcp-guide__step-index">1</span>
          <div>
            <h3 class="mcp-guide__step-title">{{ i18nHelper.todo.mcpStepConnect }}</h3>
            <p class="mcp-guide__step-hint">{{ i18nHelper.todo.mcpStepConnectHint }}</p>
          </div>
        </div>

        <div class="mcp-guide__field">
          <div class="mcp-guide__field-head">
            <span class="mcp-guide__field-title">{{ i18nHelper.todo.mcpCommandPath }}</span>
            <IconBtn
              class="mcp-guide__copy-button"
              :disabled="!commandPath"
              :title="i18nHelper.todo.mcpCopy"
              :aria-label="i18nHelper.todo.mcpCopy"
              @click="copyText(commandPath)"
            >
              <IconCopy class="mcp-guide__copy-icon" :size="18" stroke="1.8" />
            </IconBtn>
          </div>
          <code class="mcp-guide__code">{{ commandPathText }}</code>
        </div>

        <div class="mcp-guide__field">
          <div class="mcp-guide__field-head">
            <span class="mcp-guide__field-title">{{ i18nHelper.todo.mcpConfig }}</span>
            <IconBtn
              class="mcp-guide__copy-button"
              :disabled="!configJson"
              :title="i18nHelper.todo.mcpCopy"
              :aria-label="i18nHelper.todo.mcpCopy"
              @click="copyText(configJson)"
            >
              <IconCopy class="mcp-guide__copy-icon" :size="18" stroke="1.8" />
            </IconBtn>
          </div>
          <pre class="mcp-guide__code">{{ configJsonText }}</pre>
        </div>
      </section>

      <section name="mcp-guide__skill-step" class="mcp-guide__step">
        <div class="mcp-guide__step-head">
          <span class="mcp-guide__step-index">2</span>
          <div>
            <h3 class="mcp-guide__step-title">{{ i18nHelper.todo.mcpStepSkill }}</h3>
            <p class="mcp-guide__step-hint">{{ i18nHelper.todo.mcpStepSkillHint }}</p>
          </div>
        </div>

        <div class="mcp-guide__field">
          <div class="mcp-guide__field-head">
            <span class="mcp-guide__field-title">{{ i18nHelper.todo.mcpSkillPath }}</span>
            <IconBtn
              class="mcp-guide__copy-button"
              :disabled="skillState.status !== 'ready'"
              :title="i18nHelper.todo.mcpCopy"
              :aria-label="i18nHelper.todo.mcpCopy"
              @click="copyText(skillPath)"
            >
              <IconCopy class="mcp-guide__copy-icon" :size="18" stroke="1.8" />
            </IconBtn>
          </div>
          <a-alert
            v-if="skillState.status === 'restart-required'"
            class="mcp-guide__contract-error"
            type="error"
            show-icon
            :title="i18nHelper.todo.mcpRestartRequiredTitle"
          >
            {{ i18nHelper.todo.mcpRestartRequiredDescription }}
          </a-alert>
          <code v-else class="mcp-guide__code">{{ skillPathText }}</code>
          <p class="mcp-guide__destination">{{ i18nHelper.todo.mcpSkillDestination }}</p>
        </div>
      </section>

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
const infoPending = computed(() => props.info === null);
const commandPath = computed(() => readRequiredText(props.info?.commandPath));
const configJson = computed(() => readRequiredText(props.info?.configJson));
const instruction = computed(() => readRequiredText(props.info?.instruction));
const displayRequiredText = (value: string): string =>
  infoPending.value
    ? i18nHelper.todo.mcpLoading
    : value || i18nHelper.todo.mcpRestartRequiredDescription;
const commandPathText = computed(() => displayRequiredText(commandPath.value));
const configJsonText = computed(() => displayRequiredText(configJson.value));
const skillState = computed(() =>
  resolveMcpIntegrationSkillState(props.info, TODO_AGENT_SKILL_VERSION_CODE),
);
const skillPath = computed(() =>
  skillState.value.status === 'ready' ? skillState.value.skillPath : '',
);
const skillPathText = computed(() =>
  skillState.value.status === 'pending' ? i18nHelper.todo.mcpLoading : skillPath.value,
);

const copyText = async (text: string): Promise<void> => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    Message.success(i18nHelper.todo.mcpCopied);
  } catch {
    Message.error(i18nHelper.todo.mcpCopyFailed);
  }
};

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
