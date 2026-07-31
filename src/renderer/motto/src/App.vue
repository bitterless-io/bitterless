<template>
  <div name="motto__app" class="motto">
    <header name="motto__header" class="motto__header">
      <h1 class="motto__title">{{ i18nHelper.motto.title }}</h1>
      <IconBtn
        name="motto__add"
        class="motto__add"
        :title="i18nHelper.motto.add"
        :aria-label="i18nHelper.motto.add"
        @click="mottoStore.openAddEditor()"
      >
        <IconPlus :size="18" aria-hidden="true" />
      </IconBtn>
    </header>

    <a-alert
      v-if="storageErrorMessage"
      name="motto__storageError"
      class="motto__storage-error"
      type="error"
      show-icon
      :title="storageErrorMessage"
    />

    <main name="motto__content" class="motto__content">
      <section
        v-if="mottoStore.items.length"
        name="motto__list"
        class="motto__list"
        :aria-label="i18nHelper.motto.listLabel"
      >
        <article
          v-for="item in mottoStore.items"
          :key="item.id"
          name="motto__card"
          class="motto__card"
        >
          <div class="motto__card-content">
            <h2 class="motto__card-title">{{ item.title }}</h2>
            <p v-if="item.subtitle" class="motto__card-subtitle">{{ item.subtitle }}</p>
          </div>

          <a-dropdown trigger="click" position="br">
            <IconBtn
              name="motto__cardMenu"
              class="motto__card-menu"
              :title="i18nHelper.motto.cardActions"
              :aria-label="i18nHelper.motto.cardActions"
              @click.stop
            >
              <IconDots :size="18" aria-hidden="true" />
            </IconBtn>
            <template #content>
              <a-doption @click="mottoStore.openEditEditor(item)">
                <IconPencil :size="14" aria-hidden="true" />
                {{ i18nHelper.motto.edit }}
              </a-doption>
              <a-doption class="motto__delete-option" @click="mottoStore.deleteItem(item.id)">
                <IconTrash :size="14" aria-hidden="true" />
                {{ i18nHelper.motto.delete }}
              </a-doption>
            </template>
          </a-dropdown>
        </article>
      </section>

      <section v-else name="motto__empty" class="motto__empty">
        <span class="motto__empty-icon" aria-hidden="true">
          <IconNotes :size="24" />
        </span>
        <h2>{{ i18nHelper.motto.emptyTitle }}</h2>
        <p>{{ i18nHelper.motto.emptyBody }}</p>
        <a-button type="primary" size="mini" @click="mottoStore.openAddEditor()">
          <template #icon><IconPlus :size="15" aria-hidden="true" /></template>
          {{ i18nHelper.motto.add }}
        </a-button>
      </section>
    </main>

    <a-modal
      :visible="mottoStore.editorVisible"
      :footer="false"
      :width="440"
      modal-class="motto-editor"
      title-align="start"
      unmount-on-close
      @open="focusTitleInput"
      @cancel="mottoStore.cancelEditor()"
    >
      <template #title>{{ editorTitle }}</template>
      <a-form
        name="motto__editorForm"
        class="motto-editor__form"
        layout="vertical"
        :model="mottoStore"
        @submit.prevent
      >
        <a-form-item field="draftTitle" :label="i18nHelper.motto.form.title" required>
          <a-input
            ref="titleInputRef"
            v-model="mottoStore.draftTitle"
            size="small"
            allow-clear
            autocomplete="off"
            :placeholder="i18nHelper.motto.form.titlePlaceholder"
            @press-enter="mottoStore.submitEditor()"
          />
        </a-form-item>
        <a-form-item field="draftSubtitle" :label="i18nHelper.motto.form.subtitle">
          <a-input
            v-model="mottoStore.draftSubtitle"
            size="small"
            allow-clear
            autocomplete="off"
            :placeholder="i18nHelper.motto.form.subtitlePlaceholder"
            @press-enter="mottoStore.submitEditor()"
          />
        </a-form-item>
        <div name="motto__editorActions" class="motto-editor__actions">
          <a-button size="mini" @click="mottoStore.cancelEditor()">
            {{ i18nHelper.motto.form.cancel }}
          </a-button>
          <a-button
            type="primary"
            size="mini"
            :disabled="!mottoStore.canSubmitEditor"
            @click="mottoStore.submitEditor()"
          >
            {{ editorSubmitLabel }}
          </a-button>
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { IconDots, IconNotes, IconPencil, IconPlus, IconTrash } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { mottoStore } from './store/motto.store';

const titleInputRef = ref<{ focus: () => void } | null>(null);

const editorTitle = computed(() =>
  mottoStore.editorMode === 'edit'
    ? i18nHelper.motto.form.editTitle
    : i18nHelper.motto.form.addTitle
);

const editorSubmitLabel = computed(() =>
  mottoStore.editorMode === 'edit' ? i18nHelper.motto.form.save : i18nHelper.motto.form.add
);

const storageErrorMessage = computed(() => {
  if (mottoStore.storageError === 'read-failed') {
    return i18nHelper.motto.errors.read;
  }
  if (mottoStore.storageError === 'invalid-payload') {
    return i18nHelper.motto.errors.invalid;
  }
  if (mottoStore.storageError === 'write-failed') {
    return i18nHelper.motto.errors.write;
  }
  return '';
});

const focusTitleInput = (): void => {
  void nextTick(() => titleInputRef.value?.focus());
};

onMounted(() => {
  mottoStore.initialize();
});
</script>

<style lang="less">
@import './App.less';
</style>
