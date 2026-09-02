<template>
  <div name="motto__app" class="motto">
    <header name="motto__menuBar" class="motto-menu-bar">
      <div name="motto__menuBar__identity" class="motto-menu-bar__identity">
        <IconNotes :size="16" aria-hidden="true" />
        <h1 class="motto-menu-bar__title">{{ i18nHelper.motto.title }}</h1>
      </div>

      <div name="motto__menuBar__actions" class="motto-menu-bar__actions">
        <a-button
          name="motto__add"
          size="mini"
          type="text"
          :title="i18nHelper.motto.add"
          :aria-label="i18nHelper.motto.add"
          @click="beginAdd"
        >
          <template #icon><IconPlus :size="16" aria-hidden="true" /></template>
        </a-button>
      </div>
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
      <draggable
        v-if="mottoStore.items.length || mottoStore.pendingDraft"
        name="motto__list"
        class="motto__list"
        tag="section"
        :model-value="mottoStore.items"
        item-key="id"
        handle=".motto__drag-handle"
        :animation="180"
        :disabled="mottoStore.inlineEditorActive"
        :aria-label="i18nHelper.motto.listLabel"
        @update:model-value="reorderItems"
      >
        <template #item="{ element: item }">
          <article name="motto__card" class="motto__card">
            <div name="motto__cardContent" class="motto__card-content">
              <a-input
                v-if="mottoStore.isEditing(item.id, 'title')"
                ref="inlineInputRef"
                v-model="mottoStore.draftValue"
                name="motto__cardTitleEditor"
                class="motto__inline-input motto__inline-input--title"
                size="mini"
                autocomplete="off"
                :aria-label="i18nHelper.motto.form.title"
                @press-enter="commitInlineEdit"
                @keydown.esc.prevent.stop="cancelInlineEdit"
                @blur="commitInlineEdit"
                @click.stop
              />
              <button
                v-else
                name="motto__cardTitle"
                class="motto__card-title"
                type="button"
                @click.stop="beginEdit(item.id, 'title')"
              >
                {{ item.title }}
              </button>

              <a-input
                v-if="mottoStore.isEditing(item.id, 'subtitle')"
                ref="inlineInputRef"
                v-model="mottoStore.draftValue"
                name="motto__cardSubtitleEditor"
                class="motto__inline-input motto__inline-input--subtitle"
                size="mini"
                autocomplete="off"
                :aria-label="i18nHelper.motto.form.subtitle"
                @press-enter="commitInlineEdit"
                @keydown.esc.prevent.stop="cancelInlineEdit"
                @blur="commitInlineEdit"
                @click.stop
              />
              <button
                v-else
                name="motto__cardSubtitle"
                class="motto__card-subtitle"
                :class="{ 'motto__card-subtitle--placeholder': !item.subtitle }"
                type="button"
                @click.stop="beginEdit(item.id, 'subtitle')"
              >
                {{ item.subtitle || i18nHelper.motto.form.subtitle }}
              </button>
            </div>

            <div name="motto__cardActions" class="motto__card-actions">
              <IconBtn
                name="motto__dragHandle"
                class="motto__drag-handle"
                :title="i18nHelper.motto.dragHandle"
                :aria-label="i18nHelper.motto.dragHandle"
                :disabled="mottoStore.inlineEditorActive"
                @click.stop
              >
                <IconGripVertical :size="17" aria-hidden="true" />
              </IconBtn>
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
                  <a-doption class="motto__delete-option" @click="mottoStore.deleteItem(item.id)">
                    <IconTrash :size="14" aria-hidden="true" />
                    {{ i18nHelper.motto.delete }}
                  </a-doption>
                </template>
              </a-dropdown>
            </div>
          </article>
        </template>

        <template #footer>
          <article
            v-if="mottoStore.pendingDraft"
            name="motto__cardDraft"
            class="motto__card motto__card--draft"
          >
            <div name="motto__cardContent" class="motto__card-content">
              <a-input
                v-if="mottoStore.isEditing(mottoStore.pendingDraft.id, 'title')"
                ref="inlineInputRef"
                v-model="mottoStore.draftValue"
                name="motto__cardTitleEditor"
                class="motto__inline-input motto__inline-input--title"
                size="mini"
                autocomplete="off"
                :placeholder="i18nHelper.motto.form.titlePlaceholder"
                :aria-label="i18nHelper.motto.form.title"
                @press-enter="commitInlineEdit"
                @keydown.esc.prevent.stop="cancelInlineEdit"
                @blur="commitInlineEdit"
                @click.stop
              />
              <button
                v-else
                name="motto__cardTitle"
                class="motto__card-title motto__card-title--placeholder"
                type="button"
                @click.stop="beginEdit(mottoStore.pendingDraft.id, 'title')"
              >
                {{ i18nHelper.motto.form.title }}
              </button>
              <span
                name="motto__cardSubtitle"
                class="motto__card-subtitle motto__card-subtitle--placeholder"
              >
                {{ i18nHelper.motto.form.subtitle }}
              </span>
            </div>
          </article>
        </template>
      </draggable>

      <section v-else name="motto__empty" class="motto__empty">
        <span class="motto__empty-icon" aria-hidden="true">
          <IconNotes :size="24" />
        </span>
        <h2>{{ i18nHelper.motto.emptyTitle }}</h2>
        <p>{{ i18nHelper.motto.emptyBody }}</p>
        <a-button type="primary" size="mini" @click="beginAdd">
          <template #icon><IconPlus :size="15" aria-hidden="true" /></template>
          {{ i18nHelper.motto.add }}
        </a-button>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import draggable from 'vuedraggable';
import { IconDots, IconGripVertical, IconNotes, IconPlus, IconTrash } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { mottoStore, type MottoEditableField } from './store/motto.store';
import type { MottoItem } from './store/mottoStorage.service';

const inlineInputRef = ref<{ focus: () => void } | null>(null);

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

const focusInlineInput = (): void => {
  void nextTick(() => inlineInputRef.value?.focus());
};

const beginAdd = (): void => {
  if (mottoStore.beginAdd()) focusInlineInput();
};

const beginEdit = (id: string, field: MottoEditableField): void => {
  if (mottoStore.beginEdit(id, field)) focusInlineInput();
};

const commitInlineEdit = (): void => {
  mottoStore.commitInlineEdit();
};

const cancelInlineEdit = (): void => {
  mottoStore.cancelInlineEdit();
};

const reorderItems = (items: MottoItem[]): void => {
  mottoStore.reorderItems(items);
};

onMounted(() => {
  mottoStore.initialize();
});
</script>

<style lang="less">
@import './App.less';
</style>
