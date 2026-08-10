<template>
  <header name="trench__commandBar" class="trench-command-bar">
    <div name="trench__commandBar__contract" class="trench-command-bar__contract">
      <a-input
        v-model="workspace.data.drafts.meme.contractAddress"
        name="trench__commandBar__ca"
        class="trench-command-bar__ca"
        size="small"
        :placeholder="i18nHelper.coin.trench.caPlaceholder"
        :aria-label="i18nHelper.coin.workspace.contractAddress"
        :disabled="workspace.memeLoading"
        allow-clear
        @change="workspace.queuePersist()"
        @press-enter="workspace.analyzeFromCommand()"
      />

      <span
        v-if="lookupStatus"
        name="trench__commandBar__detection"
        class="trench-command-bar__detection"
        :class="{ 'trench-command-bar__detection--found': workspace.memeDetectedChains.length > 0 }"
        role="status"
      >
        {{ lookupStatus }}
      </span>

      <a-button
        name="trench__commandBar__pasteAnalyze"
        type="primary"
        size="small"
        :loading="workspace.clipboardLoading || workspace.memeLoading"
        :disabled="workspace.clipboardLoading || workspace.memeLoading"
        @click="workspace.pasteAndAnalyze()"
      >
        <template #icon><IconClipboard :size="15" /></template>
        {{ i18nHelper.coin.trench.pasteAnalyze }}
      </a-button>

      <a-tooltip :content="i18nHelper.coin.trench.terminalAnalyze">
        <a-button
          name="trench__commandBar__terminal"
          size="small"
          :aria-label="i18nHelper.coin.trench.terminalAnalyze"
          :loading="workspace.memeLoading"
          :disabled="workspace.memeLoading"
          @click="workspace.analyzeFromCommand()"
        >
          <template #icon><IconTerminal2 :size="15" /></template>
        </a-button>
      </a-tooltip>

      <a-tooltip :content="focusLabel">
        <a-button
          name="trench__commandBar__focus"
          size="small"
          :aria-label="focusLabel"
          :disabled="!hasContract"
          :class="{ 'trench-command-bar__icon--active': workspace.currentTokenFocused }"
          @click="workspace.addCurrentToFocus()"
        >
          <template #icon>
            <IconStarFilled v-if="workspace.currentTokenFocused" :size="15" />
            <IconStar v-else :size="15" />
          </template>
        </a-button>
      </a-tooltip>

      <a-tooltip :content="xBrowserTooltip">
        <a-button
          name="trench__commandBar__xBrowser"
          size="small"
          :aria-label="xBrowserTooltip"
          :loading="xBrowser.loading"
          :class="xBrowserButtonClass"
          @click="xBrowser.open(
            workspace.data.drafts.meme.contractAddress,
            workspace.data.xBrowser.displayMode,
          )"
        >
          <template #icon><IconBrandX :size="15" /></template>
          {{ xBrowserLabel }}
        </a-button>
      </a-tooltip>

      <a-tooltip v-if="workspace.memeLoading" :content="i18nHelper.coin.analysis.actions.cancel">
        <a-button
          name="trench__commandBar__cancel"
          size="small"
          status="danger"
          :aria-label="i18nHelper.coin.analysis.actions.cancel"
          @click="workspace.cancelMeme()"
        >
          <template #icon><IconPlayerStop :size="15" /></template>
        </a-button>
      </a-tooltip>
    </div>

    <div name="trench__commandBar__ai" class="trench-command-bar__ai">
      <a-button
        v-if="!codexConnected"
        name="trench__commandBar__codexConnect"
        type="outline"
        size="small"
        :loading="resources.codexLoading"
        :disabled="resources.codexLoading"
        @click="resources.connectCodex('browser')"
      >
        <template #icon><IconLogin :size="15" /></template>
        {{ i18nHelper.coin.trench.codexSignIn }}
      </a-button>
      <span v-else name="trench__commandBar__codexReady" class="trench-command-bar__codex-ready">
        <IconBrandOpenai :size="15" />
        {{ i18nHelper.coin.trench.codexReady }}
      </span>

      <a-select
        v-model="workspace.data.ai.model"
        name="trench__commandBar__model"
        class="trench-command-bar__model"
        size="small"
        :aria-label="i18nHelper.coin.resourcePage.codex.model"
        :disabled="workspace.aiLoading"
        @change="updateModel"
      >
        <a-option v-for="model in modelOptions" :key="model" :value="model">
          {{ model }}
        </a-option>
      </a-select>

      <a-select
        v-model="workspace.data.ai.effort"
        name="trench__commandBar__effort"
        class="trench-command-bar__effort"
        size="small"
        :aria-label="i18nHelper.coin.resourcePage.codex.effort"
        :disabled="workspace.aiLoading"
        @change="workspace.updateAiPreference()"
      >
        <a-option v-for="effort in effortOptions" :key="effort" :value="effort">
          {{ i18nHelper.coin.resourcePage.codex.efforts[effort] }}
        </a-option>
      </a-select>

      <a-tooltip :content="i18nHelper.coin.tabs.history">
        <a-button
          name="trench__commandBar__history"
          size="small"
          :aria-label="i18nHelper.coin.tabs.history"
          @click="workspace.setActivePage('history')"
        >
          <template #icon><IconHistory :size="15" /></template>
        </a-button>
      </a-tooltip>

      <a-tooltip :content="i18nHelper.coin.resources">
        <a-button
          name="trench__commandBar__resources"
          size="small"
          :aria-label="i18nHelper.coin.resources"
          @click="workspace.setActivePage('resources')"
        >
          <template #icon><IconSettings :size="15" /></template>
        </a-button>
      </a-tooltip>
    </div>

    <div v-if="commandIssue" name="trench__commandBar__error" class="trench-command-bar__error" role="alert">
      <IconAlertTriangle :size="14" />
      <span>{{ commandIssue }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconAlertTriangle,
  IconBrandOpenai,
  IconBrandX,
  IconClipboard,
  IconHistory,
  IconLogin,
  IconPlayerStop,
  IconSettings,
  IconStar,
  IconStarFilled,
  IconTerminal2,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  COIN_AI_DEFAULT_EFFORT,
  COIN_AI_MODEL_EFFORTS,
  COIN_AI_MODELS,
} from '@shared/coin/coinAnalysis.type';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';
import { coinXBrowserStore as xBrowser } from '../views/analysis/coinXBrowser.store';
import { coinResourcesStore as resources } from '../views/resources/coinResources.store';

const modelOptions = COIN_AI_MODELS;
const effortOptions = computed(() => COIN_AI_MODEL_EFFORTS[workspace.data.ai.model]);
const hasContract = computed(() => Boolean(workspace.data.drafts.meme.contractAddress.trim()));
const codexConnected = computed(() => Boolean(resources.status?.codex.connected));
const focusLabel = computed(() => workspace.currentTokenFocused
  ? i18nHelper.coin.trench.focused
  : i18nHelper.coin.trench.addFocus);
const xBrowserLabel = computed(() =>
  i18nHelper.coin.trench.xBrowser.states[xBrowser.status.state]);
const xBrowserTooltip = computed(() => xBrowser.status.errorCode
  ? i18nHelper.coin.trench.xBrowser.errors[xBrowser.status.errorCode]
  : xBrowser.status.state === 'login_required' && xBrowser.status.displayMode === 'hidden'
    ? i18nHelper.coin.trench.xBrowser.hiddenLoginRequired
    : workspace.data.xBrowser.displayMode === 'hidden'
      ? i18nHelper.coin.trench.xBrowser.openHidden
      : i18nHelper.coin.trench.xBrowser.openVisible);
const xBrowserButtonClass = computed(() => ({
  'trench-command-bar__x--ready': xBrowser.status.state === 'ready',
  'trench-command-bar__x--warning': xBrowser.status.state === 'login_required',
  'trench-command-bar__x--error': xBrowser.status.state === 'error',
}));
const commandIssue = computed(() => workspace.commandError || (
  xBrowser.status.errorCode
    ? i18nHelper.coin.trench.xBrowser.errors[xBrowser.status.errorCode]
    : xBrowser.status.state === 'login_required' && xBrowser.status.displayMode === 'hidden'
      ? i18nHelper.coin.trench.xBrowser.hiddenLoginRequired
      : ''
));
const lookupStatus = computed(() => {
  const chains = workspace.memeDetectingChains.length > 0
    ? workspace.memeDetectingChains
    : workspace.memeDetectedChains;
  if (chains.length === 0) return '';
  const labels = chains.map((chain) => i18nHelper.coin.trench.chains[chain]).join(' + ');
  const template = workspace.memeDetectingChains.length > 0
    ? i18nHelper.coin.trench.detectingChains
    : i18nHelper.coin.trench.detectedChains;
  return template.replace('{chains}', labels);
});

const updateModel = (): void => {
  if (!effortOptions.value.some((effort) => effort === workspace.data.ai.effort)) {
    workspace.data.ai.effort = COIN_AI_DEFAULT_EFFORT;
  }
  workspace.updateAiPreference();
};
</script>
