<template>
  <a-modal
    :visible="visible"
    :footer="false"
    :width="520"
    modal-class="archived-domains-modal"
    @cancel="handleClose"
  >
    <div class="archived-domains">
      <div class="archived-domains__header">
        <div>
          <div class="archived-domains__eyebrow">{{ i18nHelper.todo.archive }}</div>
          <h2>{{ i18nHelper.todo.archivedDomains }}</h2>
        </div>
        <a-button size="mini" type="text" @click="handleClose">
          <template #icon>
            <icon-close />
          </template>
        </a-button>
      </div>

      <a-input
        v-model="searchText"
        class="archived-domains__search"
        size="mini"
        allow-clear
        :placeholder="i18nHelper.todo.archivedDomainSearchPlaceholder"
      >
        <template #prefix>
          <icon-search />
        </template>
      </a-input>

      <div v-if="filteredDomains.length > 0" class="archived-domains__list">
        <div
          v-for="domain in filteredDomains"
          :key="domain.id"
          class="archived-domains__item"
        >
          <div class="archived-domains__item-main">
            <icon-archive class="archived-domains__item-icon" :size="15" />
            <div class="archived-domains__item-text">
              <div class="archived-domains__item-title">{{ domain.title }}</div>
              <div class="archived-domains__item-meta">
                {{ i18nHelper.todo.archivedAt }} {{ formatTime(domain.updated_at) }}
              </div>
            </div>
          </div>
          <p v-if="domain.description" class="archived-domains__item-description">
            {{ domain.description }}
          </p>
        </div>
      </div>

      <a-empty
        v-else
        class="archived-domains__empty"
        :description="emptyText"
      />
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { IconArchive, IconClose, IconSearch } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoStore } from '../../store/todo.store';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const searchText = ref('');

const normalizedSearch = computed(() => searchText.value.trim().toLowerCase());

const filteredDomains = computed(() => {
  const keyword = normalizedSearch.value;
  if (!keyword) return todoStore.archivedDomainList;
  return todoStore.archivedDomainList.filter((domain) => {
    const haystack = `${domain.title}\n${domain.description ?? ''}`.toLowerCase();
    return haystack.includes(keyword);
  });
});

const emptyText = computed(() => {
  return normalizedSearch.value
    ? i18nHelper.todo.archivedDomainNoMatched
    : i18nHelper.todo.archivedDomainEmpty;
});

const formatTime = (value: number): string => {
  return dayjs(value).format('YYYY-MM-DD HH:mm');
};

const handleClose = () => {
  emit('close');
};

watch(() => props.visible, (visible) => {
  if (!visible) {
    searchText.value = '';
  }
});
</script>

<style lang="less">
@import './ArchivedDomainsModal.less';
</style>
