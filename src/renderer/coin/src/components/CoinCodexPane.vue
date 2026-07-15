<template>
  <aside name="coin__codexPane" class="coin-codex-pane" aria-label="Codex">
    <header name="coin__codex__header" class="coin-codex-pane__header">
      <div class="coin-codex-pane__identity">
        <IconBrandOpenai :size="17" stroke-width="1.7" aria-hidden="true" />
        <strong>{{ i18nHelper.coin.codex.title }}</strong>
      </div>
      <span class="coin-codex-pane__runtime">
        <span class="coin-codex-pane__status-dot" aria-hidden="true"></span>
        {{ i18nHelper.coin.codex.runtimeUnavailable }}
      </span>
      <a-tooltip :content="i18nHelper.coin.codex.newChat" position="bottom">
        <span>
          <button
            name="coin__codex__newChat"
            class="coin-icon-button"
            type="button"
            :aria-label="i18nHelper.coin.codex.newChat"
            disabled
          >
            <IconPlus :size="17" stroke-width="1.8" aria-hidden="true" />
          </button>
        </span>
      </a-tooltip>
    </header>

    <div name="coin__codex__history" class="coin-codex-pane__history" data-overlay-scrollbar>
      <section class="coin-codex-unavailable" aria-live="polite">
        <IconMessageOff :size="25" stroke-width="1.5" aria-hidden="true" />
        <h2>{{ i18nHelper.coin.codex.unavailableTitle }}</h2>
        <p>{{ i18nHelper.coin.codex.unavailableBody }}</p>
        <span class="coin-unavailable-label">{{ i18nHelper.coin.unavailable }}</span>
      </section>
    </div>

    <div name="coin__codex__context" class="coin-codex-pane__context">
      <span>{{ i18nHelper.coin.codex.context }}</span>
      <strong>{{ i18nHelper.coin.codex.noContext }}</strong>
    </div>

    <div name="coin__codex__composer" class="coin-codex-pane__composer">
      <a-textarea
        :placeholder="i18nHelper.coin.codex.composerPlaceholder"
        :auto-size="{ minRows: 2, maxRows: 2 }"
        disabled
      />
      <a-tooltip :content="i18nHelper.coin.codex.send" position="top">
        <span>
          <button
            name="coin__codex__send"
            class="coin-icon-button coin-icon-button--primary"
            type="button"
            :aria-label="i18nHelper.coin.codex.send"
            disabled
          >
            <IconArrowUp :size="17" stroke-width="1.9" aria-hidden="true" />
          </button>
        </span>
      </a-tooltip>
    </div>
  </aside>
</template>

<script setup lang="ts">
import {
  IconArrowUp,
  IconBrandOpenai,
  IconMessageOff,
  IconPlus,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
</script>
