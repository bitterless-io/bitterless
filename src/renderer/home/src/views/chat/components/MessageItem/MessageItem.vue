<template>
  <div
    class="message-item"
    :class="{
      'message-item--user': role === 'user',
      'message-item--assistant': role === 'assistant',
      'message-item--highlight': highlight,
    }"
  >
    <div class="message-item__avatar">
      <icon-robot v-if="role === 'assistant'" />
      <icon-user v-else />
    </div>
    <div class="message-item__body">
      <div class="message-item__content">
        <a-spin v-if="isStreaming && !content" dot />
        <MarkdownRender
          v-else-if="role === 'assistant'"
          :content="content"
          :is-dark="false"
          :max-live-nodes="isStreaming ? 0 : undefined"
          :code-block-props="{
            lightTheme: 'github-light',
          }"
        />
        <div v-else class="message-item__text">{{ content.trim() }}</div>
      </div>
      <div v-if="!isStreaming" class="message-item__options">
        <a-button
          v-if="role === 'user' && isLast"
          type="text"
          size="mini"
          @click="onRecall"
        >
          <template #icon>
            <icon-undo />
          </template>
        </a-button>
        <a-button type="text" size="mini" @click="onCopy">
          <template #icon>
            <icon-copy />
          </template>
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconCopy, IconRobot, IconUser, IconUndo } from '@arco-design/web-vue/es/icon';
import MarkdownRender from 'markstream-vue';

interface Props {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isLast?: boolean;
  highlight?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false,
  isLast: false,
  highlight: false,
});

const emit = defineEmits<{
  recall: [];
}>();

const onCopy = () => {
  navigator.clipboard.writeText(props.content);
};

const onRecall = () => {
  emit('recall');
};
</script>

<style lang="less">
@import './MessageItem.less';
</style>
