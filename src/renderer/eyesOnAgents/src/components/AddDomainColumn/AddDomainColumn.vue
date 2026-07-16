<template>
  <aside name="eyesOnAgents__addDomain" class="add-domain-column">
    <button
      v-if="!editing"
      class="add-domain-column__button"
      type="button"
      @click="startEditing"
    >
      <IconPlus :size="17" />
      <span>{{ i18nHelper.eyesOnAgents.board.addDomain }}</span>
    </button>

    <form v-else class="add-domain-column__form" @submit.prevent="submit">
      <label for="eyes-on-agents-new-domain">
        {{ i18nHelper.eyesOnAgents.board.addDomain }}
      </label>
      <a-input
        id="eyes-on-agents-new-domain"
        ref="inputRef"
        v-model="title"
        size="small"
        :placeholder="i18nHelper.eyesOnAgents.board.domainPlaceholder"
        :error="Boolean(validationError)"
        @keydown.esc.prevent="cancel"
      />
      <span v-if="validationError" class="add-domain-column__error" role="alert">
        {{ validationError }}
      </span>
      <div class="add-domain-column__actions">
        <a-button size="mini" @click="cancel">
          {{ i18nHelper.eyesOnAgents.actions.cancel }}
        </a-button>
        <a-button
          size="mini"
          type="primary"
          html-type="submit"
          :loading="eyesOnAgentsStore.busyAction === 'domain-create'"
        >
          {{ i18nHelper.eyesOnAgents.actions.create }}
        </a-button>
      </div>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { IconPlus } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const editing = ref(false);
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
  return duplicate ? i18nHelper.eyesOnAgents.domain.duplicate : '';
});

const startEditing = async (): Promise<void> => {
  editing.value = true;
  submitted.value = false;
  await nextTick();
  inputRef.value?.focus?.();
};

const cancel = (): void => {
  editing.value = false;
  title.value = '';
  submitted.value = false;
};

const submit = async (): Promise<void> => {
  submitted.value = true;
  if (validationError.value) return;
  await eyesOnAgentsStore.createDomain(normalizedTitle.value).catch(() => undefined);
  if (!eyesOnAgentsStore.actionError) cancel();
};
</script>

<style lang="less">
@import './AddDomainColumn.less';
</style>
