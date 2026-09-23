<template>
  <div name="decision-setting" class="decision-setting">
    <a-switch
      size="small"
      :model-value="decisionSettingStore.jevEnabled"
      :disabled="!decisionSettingStore.loaded || decisionSettingStore.busy"
      @change="(value) => decisionSettingStore.setJevEnabled(value === true)"
    />
    <span class="decision-setting__label">{{ i18nHelper.setting.decision.jevLabel }}</span>
    <div class="decision-setting__hint">{{ i18nHelper.setting.decision.jevHint }}</div>
    <!--
      开关管到哪、没管到哪要写在开关旁边。已接:BJ3(ui_act 不可逆闸)、BJ1(快照选段);
      BJ2 / BJ4 / BJ5 未接(browser-use.html #4)。接线范围一变,这一行跟着改。
    -->
    <div class="decision-setting__scope">{{ i18nHelper.setting.decision.scope }}</div>
    <div v-if="decisionSettingStore.failed" class="decision-setting__failed" role="alert">
      {{ i18nHelper.setting.decision.failed }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { decisionSettingStore } from './decisionSetting.store';

onMounted(() => void decisionSettingStore.load());
</script>

<style lang="less">
@import './DecisionSetting.less';
</style>
