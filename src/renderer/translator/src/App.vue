<template>
  <div name="translator__app" class="translator">
    <header name="translator__header" class="translator__header">
      <h1 class="translator__title">{{ i18nHelper.translator.title }}</h1>
      <span class="translator__model">{{ i18nHelper.translator.model }}</span>
    </header>

    <main
      name="translator__result"
      class="translator__result"
      :class="{ 'translator__result--translating': translatorStore.translating }"
    >
      <p
        v-if="translatorStore.ready && translatorStore.translation"
        name="translator__translation"
        class="translator__translation"
        aria-live="polite"
      >
        {{ translatorStore.translation }}
      </p>
      <div v-else name="translator__empty" class="translator__empty">
        <span class="translator__empty-mark" aria-hidden="true"><IconLanguage :size="20" /></span>
        <strong>{{ resultEmptyTitle }}</strong>
        <span v-if="resultEmptyBody">{{ resultEmptyBody }}</span>
      </div>
    </main>

    <div v-if="errorMessage" name="translator__error" class="translator__error" role="alert">
      <span name="translator__error-message" class="translator__error-message">
        {{ errorMessage }}
      </span>
      <a-button
        v-if="translatorStore.canRetryTranslation"
        name="translator__retry"
        class="translator__retry"
        type="text"
        size="mini"
        :disabled="translatorStore.translating"
        @click="translatorStore.retryTranslation()"
      >
        {{ i18nHelper.translator.tryAgain }}
      </a-button>
    </div>

    <section name="translator__composer" class="translator__composer">
      <div name="translator__rail" class="translator__rail">
        <div class="translator__direction">
          <span>{{ i18nHelper.translator.autoDirection }}</span>
          <strong v-if="directionLabel">{{ directionLabel }}</strong>
        </div>
        <div class="translator__status" :class="statusClass" aria-live="polite">
          <span class="translator__status-dot" aria-hidden="true"></span>
          <span>{{ statusLabel }}</span>
        </div>
      </div>

      <a-textarea
        name="translator__source"
        class="translator__source"
        :model-value="translatorStore.sourceText"
        :placeholder="i18nHelper.translator.sourcePlaceholder"
        :max-length="translatorStore.maxSourceLength"
        :word-length="countCharacters"
        :word-slice="sliceCharacters"
        :auto-size="{ minRows: 3, maxRows: 7 }"
        :textarea-attrs="{
          autofocus: true,
          'aria-label': i18nHelper.translator.sourcePlaceholder
        }"
        size="mini"
        @input="handleInput"
        @update:model-value="handleInput"
      />

      <div class="translator__composer-footer">
        <div class="translator__auth">
          <a-button
            v-if="showLogin"
            type="primary"
            size="mini"
            :loading="
              translatorStore.providerAction || translatorStore.authState === 'authenticating'
            "
            :disabled="
              translatorStore.providerLoading || translatorStore.authState === 'authenticating'
            "
            @click="translatorStore.login()"
          >
            {{ i18nHelper.translator.login }}
          </a-button>
          <span v-if="authGuidance" class="translator__auth-guidance">{{ authGuidance }}</span>
        </div>
        <span class="translator__count">{{ characterCount }}</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { IconLanguage } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { translatorStore } from './store/translator.store';

const countCharacters = (value: string): number => Array.from(value).length;
const sliceCharacters = (value: string, length: number): string =>
  Array.from(value).slice(0, length).join('');

const handleInput = (value: string): void => {
  translatorStore.setSourceText(value);
};

const directionLabel = computed(() => {
  if (translatorStore.targetLanguage === 'zh-CN') {
    return i18nHelper.translator.translateToChinese;
  }
  if (translatorStore.targetLanguage === 'en') {
    return i18nHelper.translator.translateToEnglish;
  }
  return '';
});

const statusLabel = computed(() => {
  if (translatorStore.providerLoading) return i18nHelper.translator.checking;
  if (translatorStore.translating) return i18nHelper.translator.translating;
  if (translatorStore.authState === 'ready') return i18nHelper.translator.ready;
  if (translatorStore.authState === 'authenticating') {
    return i18nHelper.translator.authenticating;
  }
  if (translatorStore.authState === 'unavailable') return i18nHelper.translator.unavailable;
  if (translatorStore.authState === 'invalidated') return i18nHelper.translator.invalidated;
  return i18nHelper.translator.loginRequired;
});

const statusClass = computed(() => ({
  'translator__status--active': translatorStore.translating,
  'translator__status--ready': translatorStore.ready && !translatorStore.translating,
  'translator__status--blocked': !translatorStore.ready && !translatorStore.providerLoading
}));

const showLogin = computed(
  () =>
    translatorStore.authState === 'login_required' ||
    translatorStore.authState === 'invalidated' ||
    translatorStore.authState === 'unavailable' ||
    translatorStore.authState === 'authenticating'
);

const authGuidance = computed(() => {
  if (translatorStore.authState === 'invalidated') return i18nHelper.translator.invalidated;
  if (translatorStore.authState === 'authenticating') return i18nHelper.translator.authenticating;
  if (translatorStore.authState === 'login_required') return i18nHelper.translator.loginRequired;
  if (translatorStore.authState === 'unavailable') return i18nHelper.translator.unavailable;
  return '';
});

const resultEmptyTitle = computed(() => {
  if (translatorStore.providerLoading) return i18nHelper.translator.checking;
  if (authGuidance.value) return authGuidance.value;
  return i18nHelper.translator.emptyTitle;
});

const resultEmptyBody = computed(() =>
  translatorStore.ready ? i18nHelper.translator.emptyBody : ''
);

const characterCount = computed(() =>
  i18nHelper.translator.characterCount
    .replace('{count}', String(countCharacters(translatorStore.sourceText)))
    .replace('{limit}', String(translatorStore.maxSourceLength))
);

const errorMessage = computed(() => {
  const error = translatorStore.error;
  if (!error) return '';
  if (error === 'load-provider') return i18nHelper.translator.errors.loadProvider;
  if (error === 'login') return i18nHelper.translator.errors.login;
  if (error === 'invalid-input') return i18nHelper.translator.errors.invalidInput;
  if (
    error === 'invalid-output' ||
    error === 'output-too-large' ||
    error === 'target-mismatch' ||
    error === 'tool-violation'
  )
    return i18nHelper.translator.errors.invalidOutput;
  if (error === 'login-required' || error === 'authenticating' || error === 'provider-unavailable')
    return i18nHelper.translator.errors.unavailable;
  if (error === 'provider-error' || error === 'runtime-unavailable' || error === 'timeout')
    return i18nHelper.translator.errors.provider;
  return i18nHelper.translator.errors.generic;
});

onMounted(() => {
  void translatorStore.initialize();
});
</script>

<style lang="less">
@import './App.less';
</style>
