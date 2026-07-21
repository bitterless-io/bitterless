<template>
  <a-modal
    :visible="visible"
    :footer="false"
    :width="520"
    :title="i18nHelper.todo.archivedDomains"
    title-align="start"
    modal-class="archived-domains-modal"
    @cancel="handleClose"
  >
    <div name="archivedDomains__body" class="archived-domains">
      <a-input
        v-model="searchText"
        class="archived-domains__search"
        size="mini"
        allow-clear
        :aria-label="i18nHelper.todo.archivedDomainSearchPlaceholder"
        :placeholder="i18nHelper.todo.archivedDomainSearchPlaceholder"
      >
        <template #prefix>
          <IconSearch />
        </template>
      </a-input>

      <div
        v-if="filteredDomains.length > 0"
        name="archivedDomains__list"
        class="archived-domains__list"
      >
        <div
          v-for="domain in filteredDomains"
          :key="domain.id"
          name="archivedDomains__item"
          class="archived-domains__item"
        >
          <IconArchive class="archived-domains__item-icon" :size="16" />
          <div name="archivedDomains__itemText" class="archived-domains__item-text">
            <div class="archived-domains__item-title">{{ domain.title }}</div>
            <div class="archived-domains__item-meta">
              {{ i18nHelper.todo.archivedAt }} {{ formatTime(domain.updated_at) }}
            </div>
            <p v-if="domain.description" class="archived-domains__item-description">
              {{ domain.description }}
            </p>
          </div>
          <a-button
            class="archived-domains__restore"
            type="text"
            size="mini"
            :loading="restoringDomainId === domain.id"
            :disabled="restoringDomainId !== null && restoringDomainId !== domain.id"
            @click="handleRestore(domain.id)"
          >
            <template #icon>
              <IconRestore />
            </template>
            {{ i18nHelper.todo.restoreDomain }}
          </a-button>
        </div>
      </div>

      <a-empty v-else class="archived-domains__empty" :description="emptyText" />
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { Message } from '@arco-design/web-vue';
import { IconArchive, IconRestore, IconSearch } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoStore } from '../../store/todo.store';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const searchText = ref('');
const restoringDomainId = ref<string | null>(null);

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

const handleRestore = async (id: string) => {
  if (restoringDomainId.value !== null) return;

  restoringDomainId.value = id;
  try {
    const restored = await todoStore.restoreDomain(id);
    if (restored) {
      Message.success(i18nHelper.todo.restoreDomainSuccess);
    }
  } catch {
    Message.error(i18nHelper.todo.restoreDomainFailed);
  } finally {
    restoringDomainId.value = null;
  }
};

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      searchText.value = '';
    }
  }
);
</script>

<style lang="less">
@import './ArchivedDomainsModal.less';
</style>
