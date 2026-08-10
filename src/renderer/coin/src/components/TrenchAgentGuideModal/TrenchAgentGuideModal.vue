<template>
  <a-modal
    :visible="trenchAgentGuideStore.visible"
    :footer="false"
    :width="560"
    :unmount-on-close="true"
    title-align="start"
    modal-class="trench-agent-guide-modal"
    @before-open="rememberReturnFocus"
    @open="focusNativeClose"
    @close="restoreFocus"
    @cancel="trenchAgentGuideStore.close()"
  >
    <template #title>
      <div class="trench-agent-guide__title">
        <div class="trench-agent-guide__eyebrow">{{ t('trench.agentGuide.eyebrow') }}</div>
        <h2 class="trench-agent-guide__heading">{{ t('trench.agentGuide.title') }}</h2>
      </div>
    </template>

    <div name="trench__agent-guide" class="trench-agent-guide">
      <div
        v-if="trenchAgentGuideStore.phase === 'loading' || trenchAgentGuideStore.phase === 'idle'"
        name="trench__agent-guide__loading"
        class="trench-agent-guide__state"
        role="status"
      >
        <a-spin />
        <span>{{ t('trench.agentGuide.loading') }}</span>
      </div>

      <div
        v-else-if="trenchAgentGuideStore.phase === 'error'"
        name="trench__agent-guide__error"
        class="trench-agent-guide__state"
      >
        <a-alert type="error" show-icon :title="t('trench.agentGuide.loadFailedTitle')">
          {{ t('trench.agentGuide.loadFailedDescription') }}
        </a-alert>
        <a-button type="primary" @click="trenchAgentGuideStore.load()">
          {{ t('trench.actions.retry') }}
        </a-button>
      </div>

      <div
        v-else-if="trenchAgentGuideStore.phase === 'restart-required'"
        name="trench__agent-guide__restart-required"
        class="trench-agent-guide__state"
      >
        <a-alert type="error" show-icon :title="t('trench.agentGuide.restartRequiredTitle')">
          {{ restartDescription }}
        </a-alert>
        <a-button type="primary" @click="trenchAgentGuideStore.load()">
          {{ t('trench.agentGuide.retryAfterRestart') }}
        </a-button>
      </div>

      <template v-else-if="info">
        <p class="trench-agent-guide__summary">{{ t('trench.agentGuide.summary') }}</p>

        <div
          v-if="info.serverName !== 'bitterless'"
          name="trench__agent-guide__test-warning"
          class="trench-agent-guide__instance-warning"
        >
          <a-alert
            type="warning"
            show-icon
            :title="t('trench.agentGuide.testInstanceTitle', { serverName: info.serverName })"
          >
            {{ t('trench.agentGuide.testInstanceWarning') }}
          </a-alert>
        </div>

        <div class="trench-agent-guide__field trench-agent-guide__field--primary">
          <div class="trench-agent-guide__field-head">
            <div>
              <strong>{{ t('trench.agentGuide.complete') }}</strong>
              <p>{{ t('trench.agentGuide.completeHint') }}</p>
            </div>
            <CopyAction kind="complete" />
          </div>
        </div>

        <section name="trench__agent-guide__connect" class="trench-agent-guide__step">
          <div class="trench-agent-guide__step-head">
            <span class="trench-agent-guide__step-index">1</span>
            <div>
              <h3>{{ t('trench.agentGuide.connectTitle') }}</h3>
              <p>{{ t('trench.agentGuide.connectHint', { serverName: info.serverName }) }}</p>
            </div>
          </div>

          <div name="trench__agent-guide__helper" class="trench-agent-guide__field">
            <div class="trench-agent-guide__field-head">
              <strong>{{ t('trench.agentGuide.helper') }}</strong>
              <CopyAction kind="helper" />
            </div>
            <code class="trench-agent-guide__code" v-text="info.commandPath" />
          </div>

          <div name="trench__agent-guide__config" class="trench-agent-guide__field">
            <div class="trench-agent-guide__field-head">
              <strong>{{ t('trench.agentGuide.config') }}</strong>
              <CopyAction kind="config" />
            </div>
            <pre class="trench-agent-guide__code" v-text="info.configJson" />
          </div>
        </section>

        <section name="trench__agent-guide__install" class="trench-agent-guide__step">
          <div class="trench-agent-guide__step-head">
            <span class="trench-agent-guide__step-index">2</span>
            <div>
              <h3>{{ t('trench.agentGuide.installTitle') }}</h3>
              <p>{{ t('trench.agentGuide.installHint') }}</p>
            </div>
          </div>

          <div name="trench__agent-guide__skill" class="trench-agent-guide__field">
            <div class="trench-agent-guide__field-head">
              <strong>{{ t('trench.agentGuide.skill') }}</strong>
              <CopyAction kind="skill" />
            </div>
            <code class="trench-agent-guide__code" v-text="info.skillPath" />
            <dl class="trench-agent-guide__destinations">
              <div>
                <dt>{{ t('trench.agentGuide.version') }}</dt>
                <dd>{{ info.skillVersionCode }}</dd>
              </div>
              <div>
                <dt>Codex</dt>
                <dd>~/.codex/skills/bitterless-trench/</dd>
              </div>
              <div>
                <dt>Claude Code</dt>
                <dd>~/.claude/skills/bitterless-trench/</dd>
              </div>
            </dl>
          </div>
        </section>

        <section name="trench__agent-guide__restart" class="trench-agent-guide__step">
          <div class="trench-agent-guide__step-head">
            <span class="trench-agent-guide__step-index">3</span>
            <div>
              <h3>{{ t('trench.agentGuide.restartTitle') }}</h3>
              <p>{{ t('trench.agentGuide.restartHint') }}</p>
            </div>
          </div>
          <ol class="trench-agent-guide__verify-list">
            <li>{{ t('trench.agentGuide.verifyFreshSession') }}</li>
            <li>{{ t('trench.agentGuide.verifyTools') }}</li>
            <li>{{ t('trench.agentGuide.verifyInvocation') }}</li>
          </ol>
        </section>
      </template>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue';
import { useI18n } from 'vue-i18n';
import { Tooltip } from '@arco-design/web-vue';
import { IconCopy } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { trenchAgentGuideStore } from '../../views/vault/trenchAgentGuide.runtime';
import type { TrenchAgentGuideCopyKind } from '../../views/vault/trenchAgentGuide.type';

const { t } = useI18n();
const info = computed(() => trenchAgentGuideStore.info);
const restartDescription = computed(() => trenchAgentGuideStore.mismatchReason === 'version-mismatch'
  ? t('trench.agentGuide.versionMismatchDescription')
  : t('trench.agentGuide.restartRequiredDescription'));
let returnFocusTarget: HTMLElement | null = null;

const rememberReturnFocus = (): void => {
  returnFocusTarget = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
};

const focusNativeClose = (): void => {
  const close = document.querySelector(
    '.trench-agent-guide-modal .arco-modal-close-btn',
  );
  if (!(close instanceof HTMLElement)) return;
  close.tabIndex = 0;
  close.focus();
};

const restoreFocus = (): void => {
  if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
  returnFocusTarget = null;
};

const CopyAction = defineComponent({
  props: {
    kind: {
      type: String as () => TrenchAgentGuideCopyKind,
      required: true,
    },
  },
  setup(props) {
    return () => {
      const state = trenchAgentGuideStore.copyStates[props.kind];
      const label = state === 'copied'
        ? t('trench.actions.copied')
        : state === 'failed'
          ? t('trench.actions.copyFailed')
          : t(`trench.agentGuide.copy.${props.kind}`);
      return h('div', { class: 'trench-agent-guide__copy' }, [
        h(Tooltip, { content: label }, {
          default: () => h(IconBtn, {
            name: `trench__agent-guide__copy-${props.kind}`,
            class: [
              'trench-agent-guide__copy-button',
              { 'trench-agent-guide__copy-button--primary': props.kind === 'complete' },
            ],
            title: label,
            'aria-label': label,
            onClick: () => { void trenchAgentGuideStore.copy(props.kind); },
          }, { default: () => h(IconCopy, { size: '17', stroke: '1.8', 'aria-hidden': 'true' }) }),
        }),
        h('span', {
          name: `trench__agent-guide__copy-status-${props.kind}`,
          class: 'trench-agent-guide__copy-status',
          role: 'status',
        }, state === 'idle' ? '' : label),
      ]);
    };
  },
});
</script>

<style lang="less">
@import './TrenchAgentGuideModal.less';
</style>
