<template>
  <div class="message-input">
    <div class="message-input__body">
      <div class="message-input__editor">
        <QuillEditor
          ref="quillRef"
          v-model="messageStore.inputContent"
          :disabled="messageStore.isResponding"
          :placeholder="messageStore.placeholder"
          @submit="handleSubmit"
          @composition-start="handleCompositionStart"
          @composition-end="handleCompositionEnd"
          @text-change="handleTextChange"
        />
      </div>
      <div class="message-input__actions">
        <button
          v-if="messageStore.isResponding"
          class="message-input__btn message-input__btn--stop"
          @click="handleStop"
        >
          <icon-record-stop :size="20" />
        </button>
        <button
          v-else
          class="message-input__btn message-input__btn--send"
          :disabled="!messageStore.inputContent.trim()"
          @click="handleSendClick"
        >
          <icon-send :size="20" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import QuillEditor from '@/components/QuillEditor/QuillEditor.vue';
import { messageStore } from '../../store/message.store';
import { sessionStore } from '../../store/session.store';
import { IconSend, IconRecordStop } from '@arco-design/web-vue/es/icon';

const emit = defineEmits<{ sent: [] }>();

const handleCompositionStart = (): void => {
  messageStore.hidePlaceholder();
};

const handleCompositionEnd = (): void => {
  if (!quillRef.value || quillRef.value.getPlainText().length === 0) {
    messageStore.showPlaceholder();
  }
};

const handleTextChange = (text: string): void => {
  if (text.length <= 1) {
    messageStore.showPlaceholder();
  } else {
    messageStore.hidePlaceholder();
  }
};

const quillRef = ref<InstanceType<typeof QuillEditor> | null>(null);

watch(
  () => messageStore.inputContent,
  (newContent) => {
    if (newContent && quillRef.value) {
      const currentText = quillRef.value.getPlainText();
      if (currentText !== newContent) {
        quillRef.value.setText(newContent);
      }
    }
  }
);

const handleSubmit = async (content: string): Promise<void> => {
  messageStore.messageListService.lastAction = 'send';
  if (sessionStore.currentSessionId) {
    await messageStore.messageListService.prepareForSend(sessionStore.currentSessionId);
  }
  await messageStore.send(content);
  quillRef.value?.clear();
  emit('sent');
};

const handleSendClick = async (): Promise<void> => {
  const content = messageStore.inputContent.trim();
  if (!content) return;
  messageStore.messageListService.lastAction = 'send';
  if (sessionStore.currentSessionId) {
    await messageStore.messageListService.prepareForSend(sessionStore.currentSessionId);
  }
  await messageStore.send(content);
  quillRef.value?.clear();
  emit('sent');
};

const handleStop = async (): Promise<void> => {
  await messageStore.stopResponse();
};

const focus = (): void => {
  quillRef.value?.focus();
};

onMounted(() => {
  messageStore.setMessageInputFocus(focus);
});

onUnmounted(() => {
  messageStore.setMessageInputFocus(null);
});

defineExpose({ focus });
</script>

<style lang="less">
@import './MessageInput.less';
</style>
