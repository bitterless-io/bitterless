<template>
  <div class="llm-setting">
    <div class="llm-setting__form">
      <div class="llm-setting__field">
        <label class="llm-setting__label">{{ i18nHelper.setting.llm.provider }}</label>
        <a-select
          v-model="llmSettingStore.llmSetting.provider"
          :placeholder="i18nHelper.setting.llm.providerPlaceholder"
          class="llm-setting__input"
          allow-search
          @change="onProviderChange"
        >
          <a-option v-for="p in PROVIDER_LIST" :key="p" :value="p">{{ p }}</a-option>
        </a-select>
      </div>
      <div class="llm-setting__field">
        <label class="llm-setting__label">{{ i18nHelper.setting.llm.model }}</label>
        <a-select
          v-model="llmSettingStore.llmSetting.model"
          :placeholder="i18nHelper.setting.llm.modelPlaceholder"
          class="llm-setting__input"
          allow-search
        >
          <a-option v-for="m in filteredModels" :key="m.name" :value="m.name">{{ m.name }}</a-option>
        </a-select>
      </div>
      <div class="llm-setting__field">
        <label class="llm-setting__label">{{ i18nHelper.setting.llm.apiKey }}</label>
        <a-input-password
          v-model="llmSettingStore.llmSetting.apiKey"
          :placeholder="i18nHelper.setting.llm.apiKeyPlaceholder"
          class="llm-setting__input"
          allow-clear
        />
      </div>
      <div class="llm-setting__field">
        <label class="llm-setting__label">{{ i18nHelper.setting.llm.endpoint }}</label>
        <BLDropdownList trigger="click" :popup-max-height="200">
          <a-input
            ref="endpointInputRef"
            v-model="llmSettingStore.llmSetting.endpoint"
            :placeholder="i18nHelper.setting.llm.endpointPlaceholder"
            class="llm-setting__input"
            allow-clear
          />
          <template #content>
            <BLDropdownListItem
              v-for="item in filteredEndpointOptions"
              :key="item.value"
              :item-key="item.value"
              @click="applyEndpoint"
            >
              {{ item.label }}
            </BLDropdownListItem>
          </template>
        </BLDropdownList>
        <div class="llm-setting__hint">{{ i18nHelper.setting.llm.endpointHint }}</div>
      </div>
      <div class="llm-setting__actions">
        <a-button type="primary" :loading="llmSettingStore.loading" @click="handleSave">
          {{ i18nHelper.setting.llm.save  }}
        </a-button>
        <span v-if="llmSettingStore.saveStatus === 'success'" class="llm-setting__status--success">
          {{ i18nHelper.setting.llm.saveSuccess }}
        </span>
        <span v-if="llmSettingStore.saveStatus === 'failed'" class="llm-setting__status--failed">
          {{ i18nHelper.setting.llm.saveFailed }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { llmSettingStore, loadLLMSetting, saveLLMSetting } from './llmSetting.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { PROVIDER_LIST, getModelsByProvider } from '../../store/model.constant';
import { ENDPOINT_OPTIONS } from '../../store/endpoint.constant';
import { BLDropdownList, BLDropdownListItem } from '@renderer/common/components/BLDropdownList';

const filteredModels = computed(() => getModelsByProvider(llmSettingStore.llmSetting.provider));

const onProviderChange = (): void => {
  llmSettingStore.llmSetting.model = '';
};

const endpointInputRef = ref();

const filteredEndpointOptions = computed(() => {
  const keyword = (llmSettingStore.llmSetting.endpoint || '').toLowerCase();
  if (!keyword) {
    return ENDPOINT_OPTIONS;
  }
  return ENDPOINT_OPTIONS.filter((item) =>
    item.label.toLowerCase().includes(keyword) || item.value.toLowerCase().includes(keyword),
  );
});

const applyEndpoint = (value: string | number | null): void => {
  if (typeof value === 'string') {
    llmSettingStore.llmSetting.endpoint = value;
  }
};

const handleSave = async (): Promise<void> => {
  await saveLLMSetting();
};

onMounted(() => {
  loadLLMSetting();
});
</script>

<style lang="less">
@import './LLMSetting.less';
</style>
