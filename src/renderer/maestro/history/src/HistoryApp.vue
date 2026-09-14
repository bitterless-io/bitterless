<template>
  <div name="browser-history" class="browser-history full-container" @keydown="historyStore.keydown($event)" @mouseup="historyStore.action('focus')">
    <div name="browser-history__panel" class="browser-history__panel">
      <div name="browser-history__header" class="browser-history__header">
        <span>{{ i18nHelper.browserHistory.title }}</span>
        <IconBtn name="browser-history__close" class="browser-history__icon" size="mini" :aria-label="i18nHelper.browserHistory.hide" :title="i18nHelper.browserHistory.hide" @click="historyStore.action('close')"><IconX :size="16" /></IconBtn>
      </div>
      <div name="browser-history__candidates" role="listbox" :aria-label="i18nHelper.browserHistory.title">
      <div v-if="historyStore.googleUrl" name="browser-history__google" class="browser-history__row" :class="{ 'browser-history__row--selected': historyStore.snapshot.selectedIndex === 0 }" role="option" :aria-selected="historyStore.snapshot.selectedIndex === 0">
        <button name="browser-history__google-search" class="browser-history__visit" type="button" @click="historyStore.action('accept', historyStore.googleUrl)"><IconSearch class="browser-history__favicon" :size="17" /><span class="browser-history__search-title">{{ i18nHelper.browserHistory.searchGoogle.replace('{query}', historyStore.snapshot.query) }}</span></button>
      </div>
      <div v-if="historyStore.snapshot.loading" class="browser-history__message" role="status">{{ i18nHelper.browserHistory.loading }}</div>
      <div v-else-if="historyStore.snapshot.error" class="browser-history__message" role="alert">
        <span>{{ i18nHelper.browserHistory.error }}</span>
        <a-button size="mini" type="text" @click="historyStore.action('retry')">{{ i18nHelper.browserHistory.retry }}</a-button>
      </div>
      <div v-else-if="!historyStore.snapshot.entries.length" class="browser-history__message" role="status">{{ historyStore.snapshot.query ? i18nHelper.browserHistory.noMatches : i18nHelper.browserHistory.empty }}</div>
      <div v-else name="browser-history__list" class="browser-history__list">
        <div v-for="(entry, index) in historyStore.snapshot.entries" :key="entry.url" name="browser-history__row" class="browser-history__row" :class="{ 'browser-history__row--selected': historyStore.historySelected(index) }" role="option" :aria-selected="historyStore.historySelected(index)">
          <button name="browser-history__visit" class="browser-history__visit" type="button" :title="entry.title + ' — ' + entry.url" @click="historyStore.action('accept', entry.url)">
            <img v-if="entry.favicon && !historyStore.failedIcons.has(entry.favicon)" class="browser-history__favicon" :src="entry.favicon" alt="" referrerpolicy="no-referrer" @error="historyStore.iconFailed(entry.favicon)" />
            <IconHistory v-else class="browser-history__favicon" :size="17" />
            <span class="browser-history__title">{{ entry.title || historyStore.displayUrl(entry.url) }}</span>
            <span class="browser-history__url">{{ historyStore.displayUrl(entry.url) }}</span>
          </button>
          <IconBtn name="browser-history__remove" class="browser-history__icon" size="mini" :aria-label="i18nHelper.browserHistory.remove" :title="i18nHelper.browserHistory.remove" @click.stop="historyStore.action('remove', entry.url)"><IconX :size="15" /></IconBtn>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconHistory, IconSearch, IconX } from '@tabler/icons-vue';
import IconBtn from '../../../common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { historyStore } from './history.store';
</script>

<style lang="less">
@import './HistoryApp.less';
</style>
