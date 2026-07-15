<template>
  <section
    name="coin__resourcesPage"
    class="coin-resources-page"
    aria-labelledby="coin-resources-title"
  >
    <header name="coin__resources__header" class="coin-resources-page__header">
      <div>
        <h1 id="coin-resources-title">{{ i18nHelper.coin.resourcePage.title }}</h1>
        <p>{{ i18nHelper.coin.resourcePage.subtitle }}</p>
      </div>
      <span class="coin-resources-page__summary">
        <IconAlertCircle :size="15" stroke-width="1.8" aria-hidden="true" />
        {{ i18nHelper.coin.resourcePage.setupUnavailable }}
      </span>
    </header>

    <div name="coin__resources__body" class="coin-resources-page__body" data-overlay-scrollbar>
      <section name="coin__resources__ai" class="coin-resource-section">
        <header class="coin-resource-section__header">
          <IconBrandOpenai :size="17" stroke-width="1.8" aria-hidden="true" />
          <h2>{{ i18nHelper.coin.resourcePage.sections.ai }}</h2>
        </header>
        <div class="coin-resource-list">
          <div name="coin__resources__codex" class="coin-resource-row">
            <span class="coin-resource-row__icon">
              <IconBrandOpenai :size="18" stroke-width="1.7" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ i18nHelper.coin.resourcePage.codex.name }}</strong>
                <span class="coin-resource-state coin-resource-state--warning">
                  <IconAlertCircle :size="13" stroke-width="1.9" aria-hidden="true" />
                  {{ i18nHelper.coin.resourcePage.codex.status }}
                </span>
              </div>
              <span class="coin-resource-row__detail">
                {{ i18nHelper.coin.resourcePage.codex.detail }}
              </span>
            </div>
            <div class="coin-resource-row__actions">
              <a-button type="primary" size="small" disabled :title="i18nHelper.coin.unavailable">
                <template #icon><IconLogin :size="15" /></template>
                {{ i18nHelper.coin.resourcePage.codex.connect }}
              </a-button>
            </div>
          </div>
        </div>
      </section>

      <section name="coin__resources__gmgn" class="coin-resource-section">
        <header class="coin-resource-section__header">
          <IconTerminal2 :size="17" stroke-width="1.8" aria-hidden="true" />
          <h2>{{ i18nHelper.coin.resourcePage.sections.localData }}</h2>
        </header>
        <div class="coin-resource-list">
          <div name="coin__resources__gmgnCli" class="coin-resource-row">
            <span class="coin-resource-row__icon">
              <IconTerminal2 :size="18" stroke-width="1.7" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ i18nHelper.coin.resourcePage.gmgn.cliName }}</strong>
                <span class="coin-resource-state">
                  {{ i18nHelper.coin.resourcePage.notChecked }}
                </span>
              </div>
              <span class="coin-resource-row__detail">
                {{ i18nHelper.coin.resourcePage.gmgn.cliDetail }}
              </span>
              <div class="coin-resource-command">
                <span>{{ i18nHelper.coin.resourcePage.gmgn.installCommand }}</span>
                <code>yarn global add gmgn-cli</code>
              </div>
            </div>
            <div class="coin-resource-row__actions">
              <a-button size="small" disabled :title="i18nHelper.coin.unavailable">
                <template #icon><IconCopy :size="15" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.copy }}
              </a-button>
              <a-button size="small" disabled :title="i18nHelper.coin.unavailable">
                <template #icon><IconRefresh :size="15" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.recheck }}
              </a-button>
              <a-button size="small" disabled :title="i18nHelper.coin.unavailable">
                <template #icon><IconBook2 :size="15" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.guide }}
              </a-button>
            </div>
          </div>

          <div name="coin__resources__gmgnKey" class="coin-resource-row">
            <span class="coin-resource-row__icon">
              <IconKeyOff :size="18" stroke-width="1.7" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ i18nHelper.coin.resourcePage.gmgn.apiKey }}</strong>
                <span class="coin-resource-state coin-resource-state--warning">
                  {{ i18nHelper.coin.resourcePage.notConfigured }}
                </span>
              </div>
              <span class="coin-resource-row__detail">
                {{ i18nHelper.coin.resourcePage.gmgn.keyDetail }}
              </span>
            </div>
            <div class="coin-resource-row__actions">
              <a-button size="small" disabled :title="i18nHelper.coin.unavailable">
                <template #icon><IconSettings :size="15" /></template>
                {{ i18nHelper.coin.resourcePage.configure }}
              </a-button>
              <a-button size="small" disabled :title="i18nHelper.coin.unavailable">
                <template #icon><IconShieldCheck :size="15" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.verify }}
              </a-button>
            </div>
          </div>
        </div>
      </section>

      <section name="coin__resources__chains" class="coin-resource-section">
        <header class="coin-resource-section__header">
          <IconCloudOff :size="17" stroke-width="1.8" aria-hidden="true" />
          <h2>{{ i18nHelper.coin.resourcePage.sections.chainData }}</h2>
        </header>
        <div class="coin-resource-list">
          <div
            v-for="chain in chainResources"
            :key="chain.id"
            name="coin__resources__chainRow"
            class="coin-resource-row"
          >
            <span class="coin-resource-row__icon">
              <IconCloudOff :size="18" stroke-width="1.7" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ chain.name }}</strong>
                <span class="coin-resource-state coin-resource-state--warning">
                  {{ i18nHelper.coin.resourcePage.notConfigured }}
                </span>
              </div>
              <span class="coin-resource-row__detail">
                {{ i18nHelper.coin.resourcePage.chainDetail }}
              </span>
            </div>
            <div class="coin-resource-row__actions">
              <a-button size="small" disabled :title="i18nHelper.coin.unavailable">
                <template #icon><IconSettings :size="15" /></template>
                {{ i18nHelper.coin.resourcePage.configure }}
              </a-button>
            </div>
          </div>
        </div>
      </section>

      <section name="coin__resources__services" class="coin-resource-section">
        <header class="coin-resource-section__header">
          <IconServerOff :size="17" stroke-width="1.8" aria-hidden="true" />
          <h2>{{ i18nHelper.coin.resourcePage.sections.services }}</h2>
        </header>
        <div class="coin-resource-list">
          <div
            v-for="service in serviceResources"
            :key="service.id"
            name="coin__resources__serviceRow"
            class="coin-resource-row"
          >
            <span class="coin-resource-row__icon">
              <IconServerOff :size="18" stroke-width="1.7" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ service.name }}</strong>
                <span class="coin-resource-state coin-resource-state--warning">
                  {{ i18nHelper.coin.resourcePage.notConfigured }}
                </span>
              </div>
              <span class="coin-resource-row__detail">
                {{ i18nHelper.coin.resourcePage.serviceDetail }}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconAlertCircle,
  IconBook2,
  IconBrandOpenai,
  IconCloudOff,
  IconCopy,
  IconKeyOff,
  IconLogin,
  IconRefresh,
  IconServerOff,
  IconSettings,
  IconShieldCheck,
  IconTerminal2,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const chainResources = computed(() => [
  { id: 'robinhood', name: i18nHelper.coin.resourcePage.chains.robinhood },
  { id: 'bsc', name: i18nHelper.coin.resourcePage.chains.bsc },
  { id: 'solana', name: i18nHelper.coin.resourcePage.chains.solana },
]);

const serviceResources = computed(() => [
  { id: 'monitor', name: i18nHelper.coin.resourcePage.services.monitor },
  { id: 'screener', name: i18nHelper.coin.resourcePage.services.screener },
  { id: 'meme', name: i18nHelper.coin.resourcePage.services.meme },
]);
</script>
