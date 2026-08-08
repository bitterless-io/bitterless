<template>
  <section
    v-if="receipt || running || error"
    name="coin__aiInterpretation"
    class="coin-analysis-section coin-ai-interpretation"
    aria-live="polite"
  >
    <div class="coin-ai-interpretation__heading">
      <div>
        <span class="coin-section-kicker">CODEX</span>
        <h3>{{ i18nHelper.coin.analysis.ai.title }}</h3>
      </div>
      <div v-if="receipt" class="coin-ai-interpretation__meta">
        <span>{{ receipt.model }} · {{ receipt.effort }}</span>
        <span>{{ formatDate(receipt.completedAt) }}</span>
        <span>{{ i18nHelper.coin.analysis.metrics.confidence }} {{ formatPercent(receipt.result.confidence) }}</span>
      </div>
    </div>

    <div v-if="running" class="coin-ai-interpretation__loading">
      <a-spin :size="16" />
      <span>{{ i18nHelper.coin.analysis.ai.running }}</span>
      <a-button
        size="mini"
        status="warning"
        :loading="workspace.aiCancelling"
        :disabled="workspace.aiCancelling"
        @click="workspace.cancelAi()"
      >
        <template #icon><IconPlayerStop :size="14" /></template>
        {{ i18nHelper.coin.analysis.ai.cancel }}
      </a-button>
    </div>

    <div v-if="error" class="coin-inline-error" role="alert">
      <IconAlertTriangle :size="16" />
      <span>{{ error }}</span>
    </div>

    <template v-if="receipt">
      <div v-if="receipt.userThesis" class="coin-ai-interpretation__submitted-thesis">
        <h4>{{ i18nHelper.coin.analysis.ai.submittedThesis }}</h4>
        <p>{{ receipt.userThesis }}</p>
      </div>
      <p class="coin-ai-interpretation__summary">{{ receipt.result.summary }}</p>

      <div class="coin-ai-interpretation__columns">
        <div>
          <h4>{{ i18nHelper.coin.analysis.ai.attentionThesis }}</h4>
          <ul v-if="receipt.result.attentionThesis.length">
            <li v-for="item in receipt.result.attentionThesis" :key="item">{{ item }}</li>
          </ul>
          <span v-else class="coin-text-muted">{{ i18nHelper.coin.analysis.ai.noneReported }}</span>
        </div>
        <div>
          <h4>{{ i18nHelper.coin.analysis.ai.risks }}</h4>
          <ul v-if="receipt.result.risks.length">
            <li v-for="item in receipt.result.risks" :key="item">{{ item }}</li>
          </ul>
          <span v-else class="coin-text-muted">{{ i18nHelper.coin.analysis.ai.noneReported }}</span>
        </div>
      </div>

      <div class="coin-ai-interpretation__evidence">
        <h4>{{ i18nHelper.coin.analysis.ai.evidence }}</h4>
        <div>
          <button
            v-for="evidenceId in receipt.evidenceRefs"
            :key="evidenceId"
            type="button"
            class="coin-ai-evidence-link"
            @click="workspace.revealEvidence(evidenceId)"
          >
            <IconLink :size="13" />
            <span>{{ evidenceId }}</span>
          </button>
        </div>
      </div>

      <div class="coin-ai-interpretation__unsupported">
        <h4>{{ i18nHelper.coin.analysis.ai.unsupportedClaims }}</h4>
        <ul v-if="receipt.result.unsupportedClaims.length">
          <li v-for="item in receipt.result.unsupportedClaims" :key="item">{{ item }}</li>
        </ul>
        <span v-else class="coin-text-muted">{{ i18nHelper.coin.analysis.ai.noneReported }}</span>
      </div>

      <p class="coin-ai-interpretation__disclaimer">
        <IconShieldLock :size="14" />
        {{ i18nHelper.coin.analysis.ai.deterministicFinal }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import {
  IconAlertTriangle,
  IconLink,
  IconPlayerStop,
  IconShieldLock,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { CoinAiTargetKind } from '@shared/coin/coinAnalysis.type';
import { coinWorkspaceStore as workspace } from './coinWorkspace.store';

const props = defineProps<{
  kind: CoinAiTargetKind;
  resultId: string;
}>();

const receipt = computed(() => workspace.aiReceiptFor(props.kind, props.resultId));
const running = computed(() => workspace.isAiRunning(props.kind, props.resultId));
const error = computed(() => workspace.aiErrorFor(props.kind, props.resultId));
const formatDate = (value: number): string => dayjs(value).format('YYYY-MM-DD HH:mm:ss');
const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;
</script>
