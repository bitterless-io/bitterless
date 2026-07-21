<template>
  <Trigger
    v-model:popup-visible="popupVisible"
    trigger="click"
    position="br"
    :popup-offset="6"
    :unmount-on-close="true"
    :content-style="{ padding: '0' }"
  >
    <a-button
      name="eyesOnAgents__menuBar__addDomain"
      class="add-domain-popover__trigger"
      size="mini"
      type="text"
      :aria-label="i18nHelper.eyesOnAgents.board.addDomain"
      :aria-expanded="popupVisible"
      :disabled="Boolean(eyesOnAgentsStore.busyAction)"
    >
      <template #icon><IconPlus :size="14" aria-hidden="true" /></template>
      <span>{{ i18nHelper.eyesOnAgents.board.addDomain }}</span>
    </a-button>

    <template #content>
      <form
        name="eyesOnAgents__addDomainForm"
        class="add-domain-popover__form"
        role="dialog"
        aria-labelledby="eyes-on-agents-add-domain-title"
        @submit.prevent="submit"
        @keydown.esc.prevent.stop="close"
      >
        <label id="eyes-on-agents-add-domain-title" for="eyes-on-agents-new-domain">
          {{ i18nHelper.eyesOnAgents.board.addDomain }}
        </label>
        <a-input
          id="eyes-on-agents-new-domain"
          ref="inputRef"
          v-model="title"
          size="mini"
          :placeholder="i18nHelper.eyesOnAgents.board.domainPlaceholder"
          :error="Boolean(validationError)"
          :aria-invalid="Boolean(validationError)"
          :aria-describedby="validationError ? 'eyes-on-agents-add-domain-error' : undefined"
        />
        <span
          v-if="validationError"
          id="eyes-on-agents-add-domain-error"
          class="add-domain-popover__error"
          role="alert"
        >
          {{ validationError }}
        </span>
        <div class="add-domain-popover__actions">
          <a-button size="mini" html-type="button" @click="close">
            {{ i18nHelper.eyesOnAgents.actions.cancel }}
          </a-button>
          <a-button
            size="mini"
            type="primary"
            html-type="submit"
            :loading="eyesOnAgentsStore.busyAction === 'domain-create'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
          >
            {{ i18nHelper.eyesOnAgents.actions.create }}
          </a-button>
        </div>
      </form>
    </template>
  </Trigger>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Trigger } from '@arco-design/web-vue';
import { IconPlus } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const popupVisible = ref(false);
const title = ref('');
const submitted = ref(false);
const inputRef = ref<{ focus?: () => void } | null>(null);
const normalizedTitle = computed(() => title.value.trim());
const validationError = computed(() => {
  if (!submitted.value) return '';
  if (!normalizedTitle.value) return i18nHelper.eyesOnAgents.domain.required;
  const duplicate = eyesOnAgentsStore.domains.some(
    (domain) => domain.title.trim().toLocaleLowerCase() === normalizedTitle.value.toLocaleLowerCase(),
  );
  const reserved = normalizedTitle.value.toLocaleLowerCase() === 'all';
  return duplicate || reserved ? i18nHelper.eyesOnAgents.domain.duplicate : '';
});

const reset = (): void => {
  title.value = '';
  submitted.value = false;
};

const close = (): void => {
  popupVisible.value = false;
};

const submit = async (): Promise<void> => {
  if (eyesOnAgentsStore.busyAction) return;
  submitted.value = true;
  if (validationError.value) return;
  try {
    await eyesOnAgentsStore.createDomain(normalizedTitle.value);
    close();
  } catch {
    return;
  }
};

watch(popupVisible, async (visible) => {
  if (!visible) {
    reset();
    return;
  }
  await nextTick();
  inputRef.value?.focus?.();
});
</script>

<style lang="less">
@import './AddDomainPopover.less';
</style>
