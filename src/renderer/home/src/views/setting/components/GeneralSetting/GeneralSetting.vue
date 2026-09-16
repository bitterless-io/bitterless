<template>
  <div class="general-setting">
    <div class="general-setting__section">
      <h4 class="general-setting__section-title">{{ i18nHelper.setting.general.language.label }}</h4>
      <div class="general-setting__body">
        <a-radio-group v-model="generalSettingStore.currentLanguage" direction="vertical" @change="onLanguageChange">
          <a-radio value="en">{{ i18nHelper.setting.general.language.en }}</a-radio>
          <a-radio value="zh">{{ i18nHelper.setting.general.language.zh }}</a-radio>
        </a-radio-group>
      </div>
    </div>

    <div class="general-setting__section">
      <h4 class="general-setting__section-title">{{ i18nHelper.setting.general.searchEngine.label }}</h4>
      <div class="general-setting__body">
        <a-radio-group v-model="generalSettingStore.currentSearchEngine" direction="vertical" @change="onSearchEngineChange">
          <a-radio value="baidu">{{ i18nHelper.setting.general.searchEngine.baidu }}</a-radio>
          <a-radio value="duckduckgo">{{ i18nHelper.setting.general.searchEngine.duckduckgo }}</a-radio>
        </a-radio-group>
      </div>
    </div>

    <div name="general-setting__lan-address-section" class="general-setting__section">
      <h4 class="general-setting__section-title">{{ i18nHelper.setting.general.lanAddress.label }}</h4>
      <div name="general-setting__lan-address" class="general-setting__control">
        <div class="general-setting__control-copy">
          <div class="general-setting__lan-address-value">{{ lanAddressStore.address || '—' }}</div>
          <div v-if="lanAddressStore.status" class="general-setting__control-description">
            <template v-if="lanAddressStore.status === 'ok'">{{ lanAddressStore.interfaceName }}</template>
            <template v-else-if="lanAddressStore.status === 'none'">
              {{ i18nHelper.setting.general.lanAddress.unavailable }}
            </template>
            <template v-else>{{ i18nHelper.setting.general.lanAddress.failed }}</template>
          </div>
          <div v-if="lanAddressStore.stale" class="general-setting__control-description">
            {{ i18nHelper.setting.general.lanAddress.stale }}
          </div>
          <div
            v-if="lanAddressStore.status === 'none' && lanAddressStore.ignored.length > 0"
            class="general-setting__control-description"
          >
            {{ i18nHelper.setting.general.lanAddress.ignored }}:
            <span
              v-for="candidate in lanAddressStore.ignored"
              :key="`${candidate.interfaceName}-${candidate.address}`"
              class="general-setting__lan-address-ignored-item"
            >
              {{ candidate.address }} · {{ candidate.interfaceName }}
            </span>
          </div>
        </div>
        <IconBtn
          name="general-setting__lan-address-refresh"
          :title="i18nHelper.setting.general.lanAddress.refresh"
          :aria-label="i18nHelper.setting.general.lanAddress.refresh"
          :disabled="lanAddressStore.busy"
          @click="lanAddressStore.refresh()"
        >
          <IconRefresh :size="14" />
        </IconBtn>
      </div>
    </div>

    <div
      v-if="showChatMenuControl"
      name="general-setting__experimental"
      class="general-setting__section"
    >
      <h4 class="general-setting__section-title">{{ i18nHelper.setting.general.experimental.label }}</h4>
      <div name="general-setting__show-chat-menu" class="general-setting__control">
        <div class="general-setting__control-copy">
          <div class="general-setting__control-label">
            {{ i18nHelper.setting.general.experimental.showChatMenu }}
          </div>
          <div class="general-setting__control-description">
            {{ i18nHelper.setting.general.experimental.showChatMenuDescription }}
          </div>
        </div>
        <a-switch
          :model-value="generalSettingStore.showChatMenu"
          :loading="generalSettingStore.chatMenuLoading || generalSettingStore.chatMenuSaving"
          :disabled="generalSettingStore.chatMenuLoading || generalSettingStore.chatMenuSaving"
          @change="onChatMenuVisibilityChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { IconRefresh } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { generalSettingStore } from './generalSetting.store';
import { lanAddressStore } from './lanAddress.store';

withDefaults(defineProps<{
  showChatMenuControl?: boolean;
}>(), {
  showChatMenuControl: true,
});

onMounted(async () => {
  await generalSettingStore.loadSettings();
});

// A SECOND, separate mount hook on purpose. `loadSettings()` above awaits preload-backed emitters
// that the Maestro workbench preload never registers, so it already rejects there; extending it
// would make the LAN address silently fail to load in exactly the workbench this feature targets.
onMounted(() => {
  void lanAddressStore.load();
});

const onLanguageChange = async (): Promise<void> => {
  await generalSettingStore.changeLanguage(generalSettingStore.currentLanguage);
};

const onSearchEngineChange = (): void => {
  generalSettingStore.changeSearchEngine(generalSettingStore.currentSearchEngine);
};

const onChatMenuVisibilityChange = (value: string | number | boolean): void => {
  void generalSettingStore.changeChatMenuVisibility(value === true);
};
</script>

<style lang="less">
@import './GeneralSetting.less';
</style>
