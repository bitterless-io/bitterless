<template>
  <div name="onlypreview__settingsApp" class="onlypreview-settings">
    <header name="onlypreview__settingsHeader" class="onlypreview-settings__header">
      <div class="onlypreview-settings__title-mark" aria-hidden="true">
        <IconAdjustmentsHorizontal :size="21" />
      </div>
      <div>
        <h1>{{ onlyPreviewI18n.settings.title }}</h1>
        <p>{{ onlyPreviewI18n.settings.subtitle }}</p>
      </div>
    </header>

    <a-spin class="onlypreview-settings__spin" :loading="onlyPreviewSettingsStore.loading">
      <div class="onlypreview-settings__workspace">
        <nav
          name="onlypreview__settingsCategories"
          class="onlypreview-settings__categories"
          :aria-label="onlyPreviewI18n.settings.title"
        >
          <button
            name="onlypreview__settingsCategoryPreview"
            type="button"
            class="onlypreview-settings__category"
            :class="{
              'onlypreview-settings__category--active':
                onlyPreviewSettingsStore.activeCategory === 'preview'
            }"
            :aria-current="
              onlyPreviewSettingsStore.activeCategory === 'preview' ? 'page' : undefined
            "
            :aria-controls="
              onlyPreviewSettingsStore.activeCategory === 'preview'
                ? 'onlypreview-settings-panel-preview'
                : undefined
            "
            @click="onlyPreviewSettingsStore.selectCategory('preview')"
          >
            <IconCode :size="17" aria-hidden="true" />
            <span>{{ onlyPreviewI18n.settings.previewSection }}</span>
          </button>
          <button
            name="onlypreview__settingsCategoryProject"
            type="button"
            class="onlypreview-settings__category"
            :class="{
              'onlypreview-settings__category--active':
                onlyPreviewSettingsStore.activeCategory === 'project'
            }"
            :aria-current="
              onlyPreviewSettingsStore.activeCategory === 'project' ? 'page' : undefined
            "
            :aria-controls="
              onlyPreviewSettingsStore.activeCategory === 'project'
                ? 'onlypreview-settings-panel-project'
                : undefined
            "
            @click="onlyPreviewSettingsStore.selectCategory('project')"
          >
            <IconFolder :size="17" aria-hidden="true" />
            <span>{{ onlyPreviewI18n.settings.projectSection }}</span>
          </button>
          <button
            name="onlypreview__settingsCategoryAppearance"
            type="button"
            class="onlypreview-settings__category"
            :class="{
              'onlypreview-settings__category--active':
                onlyPreviewSettingsStore.activeCategory === 'appearance'
            }"
            :aria-current="
              onlyPreviewSettingsStore.activeCategory === 'appearance' ? 'page' : undefined
            "
            :aria-controls="
              onlyPreviewSettingsStore.activeCategory === 'appearance'
                ? 'onlypreview-settings-panel-appearance'
                : undefined
            "
            @click="onlyPreviewSettingsStore.selectCategory('appearance')"
          >
            <IconSun :size="17" aria-hidden="true" />
            <span>{{ onlyPreviewI18n.settings.appearanceSection }}</span>
          </button>
        </nav>

        <main name="onlypreview__settingsContent" class="onlypreview-settings__content">
          <div
            v-if="onlyPreviewSettingsStore.errorMessage"
            name="onlypreview__settingsError"
            class="onlypreview-settings__error"
            role="alert"
          >
            <IconAlertTriangle :size="15" aria-hidden="true" />
            {{ onlyPreviewSettingsStore.errorMessage }}
          </div>

          <section
            v-if="onlyPreviewSettingsStore.activeCategory === 'preview'"
            id="onlypreview-settings-panel-preview"
            name="onlypreview__settingsPreview"
            class="onlypreview-settings__section"
          >
            <div class="onlypreview-settings__section-heading">
              <h2>{{ onlyPreviewI18n.settings.previewSection }}</h2>
            </div>
            <div class="onlypreview-settings__row">
              <div class="onlypreview-settings__copy">
                <label for="onlypreview-font-size">{{ onlyPreviewI18n.settings.fontSize }}</label>
                <p>{{ onlyPreviewI18n.settings.fontSizeHint }}</p>
              </div>
              <a-input-number
                id="onlypreview-font-size"
                name="onlypreview__fontSize"
                size="mini"
                :model-value="onlyPreviewSettingsStore.draft.editorFontSize"
                :min="11"
                :max="24"
                :step="1"
                :precision="0"
                @change="(value) => onlyPreviewSettingsStore.setEditorFontSize(value)"
              />
            </div>
            <div class="onlypreview-settings__row">
              <div class="onlypreview-settings__copy">
                <label for="onlypreview-word-wrap">{{ onlyPreviewI18n.settings.wordWrap }}</label>
                <p>{{ onlyPreviewI18n.settings.wordWrapHint }}</p>
              </div>
              <a-switch
                id="onlypreview-word-wrap"
                name="onlypreview__wordWrap"
                size="small"
                :model-value="onlyPreviewSettingsStore.draft.wordWrap"
                @change="(value) => onlyPreviewSettingsStore.setWordWrap(value)"
              />
            </div>
          </section>

          <section
            v-if="onlyPreviewSettingsStore.activeCategory === 'project'"
            id="onlypreview-settings-panel-project"
            name="onlypreview__settingsProject"
            class="onlypreview-settings__section"
          >
            <div class="onlypreview-settings__section-heading">
              <h2>{{ onlyPreviewI18n.settings.projectSection }}</h2>
            </div>
            <div class="onlypreview-settings__row">
              <div class="onlypreview-settings__copy">
                <label for="onlypreview-single-click">{{
                  onlyPreviewI18n.settings.singleClick
                }}</label>
                <p>{{ onlyPreviewI18n.settings.singleClickHint }}</p>
              </div>
              <a-switch
                id="onlypreview-single-click"
                name="onlypreview__singleClick"
                size="small"
                :model-value="onlyPreviewSettingsStore.draft.openFilesWithSingleClick"
                @change="(value) => onlyPreviewSettingsStore.setOpenFilesWithSingleClick(value)"
              />
            </div>
          </section>

          <section
            v-if="onlyPreviewSettingsStore.activeCategory === 'appearance'"
            id="onlypreview-settings-panel-appearance"
            name="onlypreview__settingsAppearance"
            class="onlypreview-settings__section"
          >
            <div class="onlypreview-settings__section-heading">
              <h2>{{ onlyPreviewI18n.settings.appearanceSection }}</h2>
            </div>
            <div class="onlypreview-settings__row">
              <div class="onlypreview-settings__copy">
                <span class="onlypreview-settings__label">{{
                  onlyPreviewI18n.settings.theme
                }}</span>
                <p>{{ onlyPreviewI18n.settings.lightHint }}</p>
              </div>
              <a-radio name="onlypreview__themeLight" model-value="light" value="light" disabled>
                {{ onlyPreviewI18n.settings.light }}
              </a-radio>
            </div>
          </section>
        </main>
      </div>
    </a-spin>

    <footer name="onlypreview__settingsActions" class="onlypreview-settings__actions">
      <a-button
        size="mini"
        :disabled="onlyPreviewSettingsStore.saving"
        @click="onlyPreviewSettingsStore.cancel()"
      >
        {{ onlyPreviewI18n.settings.cancel }}
      </a-button>
      <a-button
        type="primary"
        size="mini"
        :loading="onlyPreviewSettingsStore.saving"
        :disabled="onlyPreviewSettingsStore.loading || !onlyPreviewSettingsStore.dirty"
        @click="onlyPreviewSettingsStore.save()"
      >
        {{
          onlyPreviewSettingsStore.saving
            ? onlyPreviewI18n.settings.saving
            : onlyPreviewI18n.settings.save
        }}
      </a-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watchEffect } from 'vue';
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconCode,
  IconFolder,
  IconSun
} from '@tabler/icons-vue';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewSettingsStore } from './onlyPreviewSettings.store';

const handleWindowKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  void onlyPreviewSettingsStore.cancel();
};

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown);
  void onlyPreviewSettingsStore.initialize();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
});

watchEffect(() => {
  document.title = onlyPreviewI18n.settings.title;
});
</script>

<style lang="less">
@import './App.less';
</style>
