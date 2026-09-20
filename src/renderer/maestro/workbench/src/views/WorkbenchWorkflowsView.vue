<template>
  <section name="workbench-workflows" class="workbench-workflows">
    <aside name="workbench-workflows__library" class="workbench-workflows__library">
      <div class="workbench-workflows__heading">
        <h2>{{ text.title }}</h2>
        <span class="workbench-workflows__heading-actions">
          <a-button size="mini" type="text" :aria-label="text.openFolder" :title="text.openFolder" @click="store.openRoot()"><IconFolderOpen :size="17" /></a-button>
          <a-button size="mini" type="text" :loading="store.loading" :aria-label="text.refresh" :title="text.refresh" @click="store.refresh()"><IconRefresh :size="17" /></a-button>
        </span>
      </div>
      <!-- A row, not one button: the path opens the folder, and its two actions are siblings —
           nesting a button inside a button is invalid and the inner one stops being reachable. -->
      <div class="workbench-workflows__root-row">
        <button type="button" name="workbench-workflows__root" class="workbench-workflows__root" :title="store.root" @click="store.openRoot()"><IconFolder :size="13" /><span>{{ store.root }}</span></button>
        <span class="workbench-workflows__path-actions">
          <button type="button" name="workbench-workflows__root-copy" class="workbench-workflows__path-action" :aria-label="text.copyPath" :title="copiedPath === store.root ? text.pathCopied : text.copyPath" @click="copyPath(store.root)"><component :is="copiedPath === store.root ? IconCheck : IconCopy" :size="14" /></button>
          <button type="button" name="workbench-workflows__root-reveal" class="workbench-workflows__path-action" :aria-label="text.openFolder" :title="text.openFolder" @click="store.openRoot()"><IconFolderOpen :size="14" /></button>
        </span>
      </div>
      <a-input v-model="store.search" size="small" allow-clear :placeholder="text.search" :aria-label="text.search"><template #prefix><IconSearch :size="15" /></template></a-input>
      <div v-if="store.error" class="workbench-workflows__notice" role="alert">{{ store.error }}<button type="button" @click="store.refresh()">{{ text.retry }}</button></div>
      <div name="workbench-workflows__list" class="workbench-workflows__list" :aria-busy="store.loading">
        <div v-if="store.loading && !store.items.length" class="workbench-workflows__empty"><a-spin /><span>{{ text.loading }}</span></div>
        <div v-else-if="!store.items.length" class="workbench-workflows__empty"><IconSitemap :size="28" stroke="1.4" /><span>{{ store.search ? text.noMatches : text.empty }}</span><span v-if="!store.search" class="workbench-workflows__empty-hint">{{ text.emptyHint }}</span></div>
        <div v-for="item in store.items" :key="item.ref" class="workbench-workflows__item-row">
        <span class="workbench-workflows__path-actions workbench-workflows__path-actions--row">
          <button type="button" :name="`workbench-workflows__item-copy-${item.dir}`" class="workbench-workflows__path-action" :aria-label="text.copyPath" :title="copiedPath === item.path ? text.pathCopied : text.copyPath" @click="copyPath(item.path)"><component :is="copiedPath === item.path ? IconCheck : IconCopy" :size="13" /></button>
          <button type="button" :name="`workbench-workflows__item-reveal-${item.dir}`" class="workbench-workflows__path-action" :aria-label="text.reveal" :title="text.reveal" @click="store.reveal(item.ref)"><IconFolderOpen :size="13" /></button>
        </span>
        <button :name="`workbench-workflows__item-${item.dir}`" type="button" class="workbench-workflows__item" :class="{ 'workbench-workflows__item--selected': item.ref === store.selectedRef }" :aria-pressed="item.ref === store.selectedRef" @click="store.select(item.ref)">
          <span class="workbench-workflows__item-title"><strong>{{ item.name }}</strong></span>
          <span class="workbench-workflows__item-description">{{ item.description }}</span>
          <!-- Title + subtitle only (Ral 2026-09-20). The status line stays for a broken package:
               dropping it too would leave a folder that cannot be read looking exactly like one that can. -->
          <span v-if="item.error" class="workbench-workflows__item-status workbench-workflows__item-status--error"><IconAlertCircle :size="12" />{{ text.broken }}</span>
        </button>
        </div>
      </div>
      <div v-if="store.snapshot?.dropped" class="workbench-workflows__notice" role="status">{{ text.dropped }}</div>
      <a-button size="mini" @click="store.importPackage()">{{ text.importPackage }}</a-button>
    </aside>
    <main name="workbench-workflows__detail" class="workbench-workflows__detail">
      <template v-if="store.selected">
        <header class="workbench-workflows__detail-header">
          <div><div class="workbench-workflows__identity"><span class="workbench-workflows__mark"><IconSitemap :size="20" /></span><h2>{{ store.selected.name }}</h2><span class="workbench-workflows__revision">{{ store.selected.dir }}</span></div><p>{{ store.selected.description }}</p></div>
          <span class="workbench-workflows__path-actions">
            <button type="button" name="workbench-workflows__detail-copy" class="workbench-workflows__path-action" :aria-label="text.copyPath" :title="copiedPath === store.selected.path ? text.pathCopied : text.copyPath" @click="copyPath(store.selected.path)"><component :is="copiedPath === store.selected.path ? IconCheck : IconCopy" :size="16" /></button>
            <button type="button" name="workbench-workflows__detail-reveal" class="workbench-workflows__path-action" :aria-label="text.reveal" :title="text.reveal" @click="store.reveal()"><IconFolderOpen :size="16" /></button>
          </span>
        </header>
        <div class="workbench-workflows__subnav"><div role="tablist"><button type="button" role="tab" :aria-selected="store.activeTab === 'flow'" :class="{ selected: store.activeTab === 'flow' }" @click="store.setTab('flow')">{{ text.flow }}</button><button type="button" role="tab" :aria-selected="store.activeTab === 'details'" :class="{ selected: store.activeTab === 'details' }" @click="store.setTab('details')">{{ text.details }}</button><button type="button" role="tab" :aria-selected="store.activeTab === 'source'" :class="{ selected: store.activeTab === 'source' }" @click="store.setTab('source')">{{ text.source }}</button></div><span v-if="store.detail" class="workbench-workflows__engine"><span></span>pi-dynamic-workflows 3</span></div>
        <div v-if="store.detailError || store.selected.error" class="workbench-workflows__notice" role="alert"><IconAlertCircle :size="16" />{{ store.detailError || store.selected.error }}<button type="button" @click="store.select(store.selected.ref)">{{ text.retry }}</button></div>
        <div v-else-if="store.loadingDetail && !store.detail" class="workbench-workflows__empty"><a-spin /><span>{{ text.loading }}</span></div>
        <template v-else-if="store.detail">
          <WorkflowPhases v-if="store.activeTab === 'flow'" :phases="store.detail.meta.phases" />
          <div v-else-if="store.activeTab === 'source'" name="workbench-workflows__source" class="workbench-workflows__source">
            <div v-if="store.loadingSource && !store.source" class="workbench-workflows__empty"><a-spin /><span>{{ text.loading }}</span></div>
            <div v-else-if="store.sourceError" class="workbench-workflows__notice" role="alert"><IconAlertCircle :size="16" /><span>{{ text.sourceFailed }}</span><span>{{ store.sourceError }}</span><button type="button" @click="store.loadSource()">{{ text.retry }}</button></div>
            <template v-else-if="store.source">
              <div class="workbench-workflows__source-bar">
                <span class="workbench-workflows__source-name">{{ store.source.name }} · {{ (store.source.bytes / 1024).toFixed(1) }} KB</span>
                <span v-if="store.source.truncated" class="workbench-workflows__source-truncated">{{ text.sourceTruncated }}</span>
                <a-button size="mini" type="text" :disabled="store.loadingSource" @click="store.copySource()"><template #icon><IconCopy :size="15" /></template>{{ store.sourceCopied ? text.sourceCopied : text.copySource }}</a-button>
              </div>
              <pre class="workbench-workflows__source-text">{{ store.source.text }}</pre>
            </template>
            <div v-else class="workbench-workflows__empty"><IconAlertCircle :size="28" /><span>{{ text.sourceEmpty }}</span></div>
          </div>
          <div v-else class="workbench-workflows__metadata">
            <h3>{{ text.package }}</h3><p>{{ store.selected.description }}</p>
            <dl><dt>{{ text.phases }}</dt><dd>{{ store.selected.phases.length ? store.selected.phases.join(' → ') : '—' }}</dd><dt>{{ text.folderPath }}</dt><dd class="workbench-workflows__hash">{{ store.selected.path }}</dd><dt>{{ text.entry }}</dt><dd>{{ store.selected.entry }}</dd><dt>{{ text.size }}</dt><dd>{{ (store.selected.bytes / 1024).toFixed(1) }} KB</dd><dt>{{ text.modified }}</dt><dd>{{ store.selected.modifiedAt ? new Date(store.selected.modifiedAt).toLocaleString() : '—' }}</dd></dl>
            <a-button size="small" @click="store.copyEntry()"><template #icon><IconCopy :size="15" /></template>{{ text.copyCommand }}</a-button><p class="workbench-workflows__explanation">{{ text.authoredPreview }}</p>
          </div>
        </template>
        <div v-else class="workbench-workflows__empty"><IconAlertCircle :size="28" /><span>{{ text.previewUnavailable }}</span></div>
      </template>
      <div v-else class="workbench-workflows__welcome"><div class="workbench-workflows__welcome-flow"><IconCode :size="21" /><span></span><IconGitBranch :size="21" /><span></span><IconCircleCheck :size="21" /></div><h2>{{ text.chooseWorkflow }}</h2><p>{{ text.chooseDescription }}</p><a-button size="small" @click="store.openRoot()"><template #icon><IconFolderOpen :size="15" /></template>{{ text.openFolder }}</a-button></div>
    </main>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { IconRefresh, IconSearch, IconSitemap, IconCircleCheck, IconAlertCircle, IconCheck, IconCopy, IconCode, IconGitBranch, IconFolder, IconFolderOpen } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { workflowLibraryStore as store } from '../workflowLibrary.store'
import WorkflowPhases from '../components/WorkflowPhases.vue'
const text = computed(() => i18nHelper.workflowLibrary)
/**
 * Which path was just copied, so the tick appears on THAT button and not on every one of them.
 * Cleared on a timer — a permanent tick stops meaning "just now".
 */
const copiedPath = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined
const copyPath = async (value: string): Promise<void> => {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    copiedPath.value = value
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copiedPath.value = '' }, 1600)
  } catch { store.error = text.value.copyFailed }
}
onMounted(() => void store.init())
onUnmounted(() => { clearTimeout(copiedTimer); store.destroy() })
</script>
<style lang="less">@import './WorkbenchWorkflowsView.less';</style>
