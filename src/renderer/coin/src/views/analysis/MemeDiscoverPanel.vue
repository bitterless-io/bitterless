<template>
  <div name="coin__meme__discover" class="coin-workspace-view coin-workspace-view--nested">
    <div name="coin__meme__discoverToolbar" class="coin-workspace-toolbar coin-workspace-toolbar--secondary">
      <div class="coin-control-group coin-control-group--wide">
        <span>{{ i18nHelper.coin.analysis.labels.launchStages }}</span>
        <a-select
          v-model="workspace.data.drafts.meme.stages"
          size="small"
          :aria-label="i18nHelper.coin.analysis.labels.launchStages"
          multiple
          :max-tag-count="1"
          :disabled="locked"
          @change="workspace.queuePersist()"
        >
          <a-option v-for="stage in stages" :key="stage" :value="stage">{{ stageLabel(stage) }}</a-option>
        </a-select>
      </div>
      <div class="coin-control-group">
        <span>{{ i18nHelper.coin.analysis.labels.timeWindow }}</span>
        <a-select v-model="workspace.data.drafts.meme.windowMinutes" size="small" :aria-label="i18nHelper.coin.analysis.labels.timeWindow" :disabled="locked" @change="workspace.queuePersist()">
          <a-option :value="15">15m</a-option>
          <a-option :value="60">1h</a-option>
          <a-option :value="360">6h</a-option>
          <a-option :value="1440">24h</a-option>
        </a-select>
      </div>
      <label class="coin-control-group coin-control-group--compact">
        <span>{{ i18nHelper.coin.analysis.labels.limit }}</span>
        <a-input-number
          v-model="workspace.data.drafts.meme.limit"
          size="small"
          :min="1"
          :max="50"
          :disabled="locked"
          @change="workspace.queuePersist()"
        />
      </label>
      <label class="coin-control-group coin-control-group--compact">
        <span>{{ i18nHelper.coin.analysis.labels.interval }}</span>
        <a-input-number
          v-model="workspace.data.drafts.meme.intervalSeconds"
          size="small"
          :min="workspace.data.drafts.meme.mode === 'local_cli_rpc' ? 60 : 15"
          :max="1800"
          :disabled="locked"
          @change="workspace.queuePersist()"
        >
          <template #suffix>s</template>
        </a-input-number>
      </label>
      <a-button
        v-if="!workspace.discoverSnapshot?.running"
        type="primary"
        size="small"
        :loading="workspace.discoverStarting"
        :disabled="locked || !sourceConfigured || workspace.data.drafts.meme.stages.length === 0"
        @click="workspace.startDiscover()"
      >
        <template #icon><IconPlayerPlay :size="15" /></template>
        {{ i18nHelper.coin.analysis.actions.start }}
      </a-button>
      <a-button
        v-else
        status="danger"
        size="small"
        :loading="workspace.discoverStopping"
        :disabled="workspace.discoverStopping"
        @click="workspace.stopDiscover()"
      >
        <template #icon><IconPlayerStop :size="15" /></template>
        {{ i18nHelper.coin.analysis.actions.stop }}
      </a-button>
    </div>

    <CoinEvidenceStrip />

    <div class="coin-workspace-view__body coin-workspace-view__body--table">
      <div v-if="workspace.discoverError" class="coin-inline-error" role="alert">
        <IconAlertTriangle :size="16" />
        <span>{{ workspace.discoverError }}</span>
      </div>

      <template v-if="workspace.discoverSnapshot">
        <div name="coin__meme__discoverSummary" class="coin-result-summary">
          <span class="coin-state-label" :class="workspace.discoverSnapshot.running ? 'coin-state-label--live' : 'coin-state-label--closed'">
            {{ workspace.discoverSnapshot.running ? i18nHelper.coin.analysis.labels.polling : i18nHelper.coin.analysis.labels.stopped }}
          </span>
          <span>{{ workspace.discoverSnapshot.candidates.length }} {{ i18nHelper.coin.analysis.labels.candidates }}</span>
          <span>{{ i18nHelper.coin.analysis.labels.started }} {{ formatDate(workspace.discoverSnapshot.startedAt) }}</span>
          <span v-if="workspace.discoverSnapshot.nextPollAt">
            {{ i18nHelper.coin.analysis.labels.nextPoll }} {{ formatDate(workspace.discoverSnapshot.nextPollAt) }}
          </span>
        </div>

        <CoinResultState
          v-if="workspace.discoverSnapshot.candidates.length === 0"
          kind="empty"
          :title="i18nHelper.coin.analysis.states.noCandidates"
          :detail="i18nHelper.coin.analysis.states.noCandidatesDetail"
        />
        <div v-else name="coin__meme__discoverTable" class="coin-data-table-scroll" data-overlay-scrollbar>
          <table class="coin-data-table coin-data-table--discover">
            <thead>
              <tr>
                <th>{{ i18nHelper.coin.analysis.columns.token }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.stage }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.age }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.curve }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.priority }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.researchScore }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.delta }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.reason }}</th>
                <th class="coin-data-table__operation">{{ i18nHelper.coin.analysis.columns.operation }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="candidate in workspace.discoverSnapshot.candidates" :key="candidate.contractAddress" name="coin__meme__candidateRow" :class="{ 'coin-data-row--stale': candidate.stale }">
                <td class="coin-data-table__identity">
                  <strong>{{ candidate.symbol || candidate.name || i18nHelper.coin.analysis.labels.unnamed }}</strong>
                  <span class="coin-address">{{ shortAddress(candidate.contractAddress) }}</span>
                </td>
                <td>{{ candidate.launchStage ? stageLabel(candidate.launchStage) : unavailable }}</td>
                <td>{{ formatValue(candidate.ageMinutes, 'm') }}</td>
                <td>{{ formatValue(candidate.curveProgressPct, '%') }}</td>
                <td>{{ candidate.pollPriority }}</td>
                <td>{{ formatValue(candidate.researchScore) }}</td>
                <td :class="deltaClass(candidate.scoreDelta)">{{ formatDelta(candidate.scoreDelta) }}</td>
                <td><span class="coin-reason-codes">{{ candidate.reasonCodes.join(', ') }}</span></td>
                <td class="coin-data-table__operation">
                  <a-tooltip :content="i18nHelper.coin.analysis.actions.inspect">
                    <a-button size="mini" :aria-label="i18nHelper.coin.analysis.actions.inspect" @click="inspect(candidate.contractAddress)">
                      <template #icon><IconSearch :size="14" /></template>
                    </a-button>
                  </a-tooltip>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <CoinResultState v-else-if="workspace.discoverStarting" kind="loading" :title="i18nHelper.coin.analysis.states.startingDiscover" />
      <CoinResultState
        v-else-if="!sourceConfigured"
        kind="unavailable"
        :title="i18nHelper.coin.analysis.states.discoverUnavailable"
        :detail="i18nHelper.coin.analysis.states.selectedModeUnavailable"
      />
      <CoinResultState
        v-else
        kind="empty"
        :title="i18nHelper.coin.analysis.states.discoverEmpty"
        :detail="i18nHelper.coin.analysis.states.discoverEmptyDetail"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import { IconAlertTriangle, IconPlayerPlay, IconPlayerStop, IconSearch } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { COIN_LAUNCH_STAGES, type CoinLaunchStage } from '@shared/coin/coinAnalysis.type';
import CoinEvidenceStrip from '../../components/CoinEvidenceStrip.vue';
import CoinResultState from './CoinResultState.vue';
import { coinWorkspaceStore as workspace } from './coinWorkspace.store';

defineProps<{ sourceConfigured: boolean }>();

const stages = COIN_LAUNCH_STAGES.filter((stage) => !['rejected', 'stale'].includes(stage));
const locked = computed(() => workspace.discoverStarting || workspace.discoverStopping || Boolean(workspace.discoverSnapshot?.running));
const unavailable = i18nHelper.coin.analysis.labels.unavailable;
const stageLabel = (stage: CoinLaunchStage): string => i18nHelper.coin.analysis.stages[stage];
const formatDate = (value: number): string => dayjs(value).format('YYYY-MM-DD HH:mm:ss');
const formatValue = (value: number | null, suffix = ''): string => value === null ? unavailable : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
const formatDelta = (value: number | null): string => value === null ? unavailable : `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
const deltaClass = (value: number | null): string => value === null ? '' : value > 0 ? 'coin-text-positive' : value < 0 ? 'coin-text-danger' : '';
const shortAddress = (value: string): string => value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
const inspect = (contractAddress: string): void => {
  workspace.data.drafts.meme.contractAddress = contractAddress;
  workspace.data.drafts.meme.view = 'analyze';
  workspace.queuePersist();
};
</script>
