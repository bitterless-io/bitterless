<template>
  <a-modal
    v-model:visible="messageSearchStore.visible"
    :title="i18nHelper.chat.search"
    :footer="false"
    width="80%"
    :body-style="{ maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0 }"
    @cancel="onClose"
    @open="onOpen"
  >
    <div class="message-search">
      <div class="message-search__input">
        <a-input
          ref="inputRef"
          v-model="messageSearchStore.keyword"
          :placeholder="i18nHelper.chat.searchPlaceholder"
          allow-clear
          @input="onSearch"
          @keydown="onKeydown"
        >
          <template #prefix>
            <icon-search />
          </template>
        </a-input>
      </div>
      <div class="message-search__results" ref="resultsRef" @scroll="onScroll">
        <div
          v-for="(msg, index) in messageSearchStore.results"
          :key="msg.id"
          class="message-search__item"
          :class="{ 'message-search__item--active': index === activeIndex }"
          @click="onMessageClick(msg)"
        >
          <div class="message-search__item-role">{{ msg.role }}</div>
          <div class="message-search__item-content">{{ msg.snippet }}</div>
          <div class="message-search__item-time">{{ formatTime(msg.created_at) }}</div>
        </div>
        <div v-if="messageSearchStore.loading" class="message-search__loading">
          <a-spin />
        </div>
        <div
          v-if="!messageSearchStore.loading && messageSearchStore.hasMore && messageSearchStore.results.length > 0"
          class="message-search__see-more"
          @click="onLoadMore"
        >
          {{ i18nHelper.chat.seeMore }}
        </div>
        <div v-if="!messageSearchStore.loading && messageSearchStore.results.length === 0 && messageSearchStore.keyword" class="message-search__empty">
          {{ i18nHelper.chat.searchNoResults }}
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { IconSearch } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import moment from 'moment';
import {
  messageSearchStore,
  handleSearch,
  loadMore,
  handleMessageClick,
  handleClose,
} from './messageSearch.store';

const resultsRef = ref<HTMLElement | null>(null);
const inputRef = ref<any>(null);
const activeIndex = ref<number>(-1);

const scrollActiveIntoView = (): void => {
  nextTick(() => {
    if (!resultsRef.value) return;
    const items = resultsRef.value.querySelectorAll<HTMLElement>('.message-search__item');
    const el = items[activeIndex.value];
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
};

const onKeydown = async (e: KeyboardEvent): Promise<void> => {
  const results = messageSearchStore.results;
  if (!results.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (activeIndex.value < results.length - 1) {
      activeIndex.value++;
      scrollActiveIntoView();
    } else if (messageSearchStore.hasMore && !messageSearchStore.loading) {
      const prevLen = results.length;
      await loadMore();
      if (messageSearchStore.results.length > prevLen) {
        activeIndex.value = prevLen;
        scrollActiveIntoView();
      }
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (activeIndex.value > 0) {
      activeIndex.value--;
      scrollActiveIntoView();
    }
  } else if (e.key === 'Enter') {
    if (activeIndex.value >= 0 && activeIndex.value < results.length) {
      await handleMessageClick(results[activeIndex.value]);
    }
  }
};

const onOpen = (): void => {
  handleClose();
  activeIndex.value = -1;
  nextTick(() => inputRef.value?.focus());
};

const onSearch = async (): Promise<void> => {
  activeIndex.value = -1;
  await handleSearch();
};

const onLoadMore = async (): Promise<void> => {
  await loadMore();
};

const onScroll = (): void => {
  if (!resultsRef.value || messageSearchStore.loading || !messageSearchStore.hasMore) return;
  const { scrollTop, scrollHeight, clientHeight } = resultsRef.value;
  if (scrollHeight - scrollTop - clientHeight < 100) {
    loadMore();
  }
};

const onMessageClick = async (msg: any): Promise<void> => {
  await handleMessageClick(msg);
};

const onClose = (): void => {
  handleClose();
  activeIndex.value = -1;
};

const formatTime = (timestamp: number): string => {
  return moment(timestamp).format('YYYY-MM-DD HH:mm:ss');
};

</script>

<style lang="less">
@import './MessageSearch.less';
</style>
