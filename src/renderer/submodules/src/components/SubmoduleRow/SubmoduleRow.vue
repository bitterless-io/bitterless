<template>
  <div
    name="submodules__row"
    class="submodule-row"
    :class="[`submodule-row--${entry.state}`, { 'submodule-row--nested': nested }]"
  >
    <div name="submodules__row__primary" class="submodule-row__line">
      <IconBtn
        v-if="expandable"
        name="submodules__row__toggleChildren"
        class="submodule-row__toggle"
        :title="toggleLabel"
        :aria-label="toggleLabel"
        :aria-expanded="expanded"
        @click="$emit('toggle', entry)"
      >
        <IconChevronRight :size="14" :class="{ 'submodule-row__chevron--open': expanded }" />
      </IconBtn>
      <!-- Every top-level row reserves the control's width, so names stay on one vertical line. -->
      <span v-else-if="!nested" class="submodule-row__toggle-spacer" aria-hidden="true" />

      <span class="submodule-row__name">{{ displayName }}</span>

      <div name="submodules__row__branch" class="submodule-row__branch">
        <span
          class="submodule-row__branch-tag"
          :class="`submodule-row__branch-tag--${entry.state}`"
        >
          <IconGitBranch :size="13" />
          {{ branchLabel }}
        </span>
        <span v-if="entry.commit" class="submodule-row__commit">{{ entry.commit }}</span>
        <IconBtn
          name="submodules__row__openInWebStorm"
          class="submodule-row__open"
          :loading="loading"
          :disabled="entry.state === 'missing'"
          :title="i18nHelper.submodules.actions.openInWebStorm"
          :aria-label="i18nHelper.submodules.actions.openInWebStorm"
          @click="$emit('open', entry)"
        >
          <IconExternalLink :size="16" />
        </IconBtn>
      </div>
    </div>

    <div name="submodules__row__secondary" class="submodule-row__line">
      <span class="submodule-row__path">{{ entry.path }}</span>

      <div
        v-if="mismatch || entryError"
        name="submodules__row__warning"
        class="submodule-row__warning"
      >
        <a-tooltip v-if="mismatch" :content="mismatchHint" position="top" mini>
          <span class="submodule-row__mismatch">
            <IconAlertTriangle :size="13" />
            {{ i18nHelper.submodules.branch.mismatch }}
          </span>
        </a-tooltip>
        <span v-if="entryError" class="submodule-row__entry-error">{{ entryError }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconAlertTriangle,
  IconChevronRight,
  IconExternalLink,
  IconGitBranch
} from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  isSubmoduleBranchMismatch,
  submoduleDisplayName,
  type SubmoduleEntry
} from '@shared/submodules/submodules.type';
import { describeBranch, describeEntryError } from '../../services/submoduleMessage.service';

const props = withDefaults(
  defineProps<{
    entry: SubmoduleEntry;
    loading: boolean;
    /** A second-level row: indented, and never a parent itself — the tree stops at two levels. */
    nested?: boolean;
    expandable?: boolean;
    expanded?: boolean;
  }>(),
  { nested: false, expandable: false, expanded: false }
);

defineEmits<{
  (event: 'open', entry: SubmoduleEntry): void;
  (event: 'toggle', entry: SubmoduleEntry): void;
}>();

const toggleLabel = computed(() =>
  (props.expanded
    ? i18nHelper.submodules.actions.collapseChildren
    : i18nHelper.submodules.actions.expandChildren
  ).replace('{count}', String(props.entry.children.length))
);

const displayName = computed(() => submoduleDisplayName(props.entry));
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
