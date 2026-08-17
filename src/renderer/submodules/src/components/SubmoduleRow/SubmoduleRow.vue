<template>
  <div name="submodules__row" class="submodule-row" :class="`submodule-row--${entry.state}`">
    <span class="submodule-row__state-dot" :class="`submodule-row__state-dot--${entry.state}`" />

    <div name="submodules__row__identity" class="submodule-row__identity">
      <span class="submodule-row__name">{{ entry.name }}</span>
      <span class="submodule-row__path">{{ entry.path }}</span>
    </div>

    <div name="submodules__row__branch" class="submodule-row__branch">
      <span class="submodule-row__branch-tag" :class="`submodule-row__branch-tag--${entry.state}`">
        <IconGitBranch :size="13" />
        {{ branchLabel }}
      </span>
      <span v-if="entry.commit" class="submodule-row__commit">{{ entry.commit }}</span>
      <a-tooltip v-if="mismatch" :content="mismatchHint" position="top" mini>
        <span class="submodule-row__mismatch">
          <IconAlertTriangle :size="13" />
          {{ i18nHelper.submodules.branch.mismatch }}
        </span>
      </a-tooltip>
      <span v-if="entryError" class="submodule-row__entry-error">{{ entryError }}</span>
    </div>

    <a-button
      name="submodules__row__openInWebStorm"
      class="submodule-row__open"
      size="mini"
      :loading="loading"
      :disabled="entry.state === 'missing'"
      :aria-label="i18nHelper.submodules.actions.openInWebStorm"
      @click="$emit('open', entry)"
    >
      <template #icon><IconExternalLink :size="14" /></template>
      {{ i18nHelper.submodules.actions.openInWebStorm }}
    </a-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconAlertTriangle, IconExternalLink, IconGitBranch } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { isSubmoduleBranchMismatch, type SubmoduleEntry } from '@shared/submodules/submodules.type';
import { describeBranch, describeEntryError } from '../../services/submoduleMessage.service';

const props = defineProps<{ entry: SubmoduleEntry; loading: boolean }>();

defineEmits<{ (event: 'open', entry: SubmoduleEntry): void }>();

const branchLabel = computed(() => describeBranch(props.entry));
const mismatch = computed(() => isSubmoduleBranchMismatch(props.entry));
const mismatchHint = computed(() =>
  i18nHelper.submodules.branch.configured.replace('{branch}', props.entry.configuredBranch ?? '')
);
const entryError = computed(() =>
  props.entry.errorCode ? describeEntryError(props.entry.errorCode) : null
);
</script>

<style lang="less">
@import './SubmoduleRow.less';
</style>
