<template>
  <a-modal
    :visible="visible"
    :footer="false"
    :width="560"
    modal-class="mcp-guide-modal"
    @cancel="handleClose"
  >
    <div class="mcp-guide">
      <div class="mcp-guide__header">
        <div>
          <div class="mcp-guide__eyebrow">{{ i18nHelper.todo.mcpEyebrow }}</div>
          <h2>{{ i18nHelper.todo.mcpTitle }}</h2>
        </div>
        <a-button size="mini" type="text" @click="handleClose">
          <template #icon>
            <IconX />
          </template>
        </a-button>
      </div>

      <p class="mcp-guide__summary">{{ i18nHelper.todo.mcpSummary }}</p>

      <div class="mcp-guide__field">
        <div class="mcp-guide__field-head">
          <span>{{ i18nHelper.todo.mcpCommandPath }}</span>
          <a-button size="mini" type="outline" @click="copyText(info?.commandPath ?? '')">
            <template #icon>
              <IconCopy />
            </template>
            {{ i18nHelper.todo.mcpCopy }}
          </a-button>
        </div>
        <code>{{ info?.commandPath || i18nHelper.todo.mcpLoading }}</code>
      </div>

      <div class="mcp-guide__field">
        <div class="mcp-guide__field-head">
          <span>{{ i18nHelper.todo.mcpConfig }}</span>
          <a-button size="mini" type="outline" @click="copyText(info?.configJson ?? '')">
            <template #icon>
              <IconCopy />
            </template>
            {{ i18nHelper.todo.mcpCopy }}
          </a-button>
        </div>
        <pre>{{ info?.configJson || i18nHelper.todo.mcpLoading }}</pre>
      </div>

      <div class="mcp-guide__field mcp-guide__field--quiet">
        <div class="mcp-guide__field-head">
          <span>{{ i18nHelper.todo.mcpAgentPrompt }}</span>
          <a-button size="mini" type="primary" @click="copyText(info?.instruction ?? '')">
            <template #icon>
              <IconCopy />
            </template>
            {{ i18nHelper.todo.mcpCopyAgentPrompt }}
          </a-button>
        </div>
        <p>{{ i18nHelper.todo.mcpAgentPromptHint }}</p>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { Message } from '@arco-design/web-vue';
import { IconCopy, IconX } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { McpIntegrationInfo } from '@shared/mcp/mcpBridge.type';

defineProps<{
  visible: boolean;
  info: McpIntegrationInfo | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const handleClose = () => {
  emit('close');
};

const copyText = async (text: string) => {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  Message.success(i18nHelper.todo.mcpCopied);
};
</script>

<style lang="less">
@import './McpGuideModal.less';
</style>
