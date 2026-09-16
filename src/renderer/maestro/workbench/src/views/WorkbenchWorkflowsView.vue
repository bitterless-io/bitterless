<template>
  <section name="workbench-workflows" class="workbench-workflows">
    <aside name="workbench-workflows__library" class="workbench-workflows__library">
      <div class="workbench-workflows__heading"><h2>{{ text.title }}</h2><a-button size="mini" type="text" :loading="store.loading" :aria-label="text.refresh" @click="store.refresh()"><IconRefresh :size="17" /></a-button></div>
      <label class="workbench-workflows__institution"><span class="workbench-workflows__institution-label">{{ text.institution }}</span><a-select v-if="store.snapshot?.institutions.length" size="small" :model-value="store.snapshot.institutionId ?? undefined" :disabled="store.loading" :aria-label="text.institution" @change="changeInstitution"><a-option v-for="institution in store.snapshot.institutions" :key="institution.id" :value="institution.id">{{ institution.name }}</a-option></a-select><span v-else>{{ store.loading ? text.loading : text.noInstitution }}</span></label>
      <div class="workbench-workflows__scope" role="group" :aria-label="text.scope"><button v-for="scope in scopes" :key="scope" type="button" :aria-pressed="store.scope === scope" :class="{ selected: store.scope === scope }" @click="store.scope = scope">{{ text.scopes[scope] }}</button></div>
      <a-input v-model="store.search" size="small" allow-clear :placeholder="text.search" :aria-label="text.search"><template #prefix><IconSearch :size="15" /></template></a-input>
      <div v-if="store.error" class="workbench-workflows__notice" role="alert">{{ store.error }}<button type="button" @click="store.refresh()">{{ text.retry }}</button></div>
      <div name="workbench-workflows__list" class="workbench-workflows__list" :aria-busy="store.loading">
        <div v-if="store.loading && !store.items.length" class="workbench-workflows__empty"><a-spin /><span>{{ text.loading }}</span></div>
        <div v-else-if="store.scope === 'institution' && store.snapshot?.status === 'unauthenticated'" class="workbench-workflows__empty">{{ text.signIn }}</div>
        <div v-else-if="store.scope === 'institution' && store.snapshot?.status === 'no-institution'" class="workbench-workflows__empty">{{ text.noMembership }}</div>
        <div v-else-if="!store.items.length" class="workbench-workflows__empty"><IconSitemap :size="28" stroke="1.4" /><span>{{ store.search ? text.noMatches : text.empty }}</span></div>
        <button v-for="item in store.items" :key="item.ref" :name="`workbench-workflows__item-${item.scope}-${item.id}`" type="button" class="workbench-workflows__item" :class="{ 'workbench-workflows__item--selected': item.ref === store.selectedRef }" :aria-pressed="item.ref === store.selectedRef" @click="store.select(item.ref)">
          <span class="workbench-workflows__item-title"><strong>{{ item.name }}</strong><small>{{ text.scopes[item.scope] }} · r{{ item.revision }}</small></span>
          <span class="workbench-workflows__item-description">{{ item.description }}</span>
          <span class="workbench-workflows__item-status" :class="{ 'workbench-workflows__item-status--error': item.syncError }"><IconAlertCircle v-if="item.syncError" :size="12" /><IconCircleCheck v-else-if="item.installedRevision === item.revision" :size="12" /><IconCloudDownload v-else :size="12" />{{ item.syncError ? text.updateFailed : item.installedRevision === item.revision ? text.synced : item.installedRevision ? text.updateAvailable : text.cloud }}</span>
        </button>
      </div>
      <a-button size="mini" @click="store.importShared()">{{ text.importShared }}</a-button>
      <div class="workbench-workflows__footer"><IconRefresh :size="12" />{{ text.autoSync }}<time v-if="store.snapshot?.lastChecked" :datetime="store.snapshot.lastChecked">{{ new Date(store.snapshot.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</time></div>
    </aside>
    <main name="workbench-workflows__detail" class="workbench-workflows__detail">
      <template v-if="store.selected">
        <header class="workbench-workflows__detail-header">
          <div><div class="workbench-workflows__identity"><span class="workbench-workflows__mark"><IconSitemap :size="20" /></span><h2>{{ store.selected.name }}</h2><span class="workbench-workflows__revision">{{ text.scopes[store.selected.scope] }} · r{{ store.selected.revision }}</span></div><p>{{ store.selected.description }}</p></div>
          <a-button size="small" :loading="store.loadingDetail" @click="store.select(store.selected.ref)"><template #icon><IconCloudDownload :size="16" /></template>{{ store.detail ? text.sync : text.download }}</a-button>
        </header>
        <div class="workbench-workflows__subnav"><div role="tablist"><button type="button" role="tab" :aria-selected="store.activeTab === 'flow'" :class="{ selected: store.activeTab === 'flow' }" @click="store.activeTab = 'flow'">{{ text.flow }}</button><button type="button" role="tab" :aria-selected="store.activeTab === 'details'" :class="{ selected: store.activeTab === 'details' }" @click="store.activeTab = 'details'">{{ text.details }}</button></div><span v-if="store.detail" class="workbench-workflows__engine"><span></span>Kimchi 0.0.9</span></div>
        <div v-if="store.detailError || store.selected.syncError" class="workbench-workflows__notice" role="alert"><IconAlertCircle :size="16" />{{ store.detailError || store.selected.syncError }}<span v-if="store.detail">{{ text.keptPrevious }}</span><button type="button" @click="store.select(store.selected.ref)">{{ text.retry }}</button></div>
        <div v-if="store.loadingDetail && !store.detail" class="workbench-workflows__empty"><a-spin /><span>{{ text.downloading }}</span></div>
        <template v-else-if="store.detail">
          <template v-if="store.activeTab === 'flow'">
            <WorkflowFlow :graph="store.detail.manifest.graph" :selected="store.selectedNodeId" @select="store.selectedNodeId = $event" />
            <div name="workbench-workflows__step" class="workbench-workflows__step"><div><span class="workbench-workflows__step-label">{{ text.selectedStep }}</span><h3>{{ store.selectedNode?.label || text.selectStep }}</h3><p>{{ store.selectedNode?.description || text.noStepDescription }}</p></div><span v-if="store.selectedNode" class="workbench-workflows__kind">{{ text.kinds[store.selectedNode.kind] }}</span></div>
          </template>
          <div v-else class="workbench-workflows__metadata">
            <h3>{{ text.package }}</h3><p>{{ store.detail.manifest.description }}</p>
            <dl><dt>{{ text.engine }}</dt><dd>{{ store.detail.manifest.engine }}</dd><dt>{{ text.cloudRevision }}</dt><dd>{{ store.selected.revision }}</dd><dt>{{ text.localRevision }}</dt><dd>{{ store.detail.installedRevision }}</dd><dt>{{ text.fileName }}</dt><dd>{{ store.selected.file_name }}</dd><dt>{{ text.size }}</dt><dd>{{ (store.selected.size / 1024).toFixed(1) }} KB</dd><dt>SHA-256</dt><dd class="workbench-workflows__hash">{{ store.selected.hash }}</dd><dt>{{ text.entry }}</dt><dd>{{ store.detail.manifest.entry }}</dd></dl>
            <a-button size="small" @click="store.copyEntry()"><template #icon><IconCopy :size="15" /></template>{{ text.copyCommand }}</a-button><p class="workbench-workflows__explanation">{{ text.authoredPreview }}</p>
          </div>
        </template>
        <div v-else class="workbench-workflows__empty"><IconAlertCircle :size="28" /><span>{{ text.previewUnavailable }}</span></div>
      </template>
      <div v-else class="workbench-workflows__welcome"><div class="workbench-workflows__welcome-flow"><IconCode :size="21" /><span></span><IconGitBranch :size="21" /><span></span><IconCircleCheck :size="21" /></div><h2>{{ text.chooseWorkflow }}</h2><p>{{ text.chooseDescription }}</p></div>
    </main>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { IconRefresh, IconSearch, IconSitemap, IconCloudDownload, IconCircleCheck, IconAlertCircle, IconCopy, IconCode, IconGitBranch } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { workflowLibraryStore as store } from '../workflowLibrary.store'
import WorkflowFlow from '../components/WorkflowFlow.vue'
const text = computed(() => i18nHelper.workflowLibrary)
const scopes = ['all', 'shared', 'institution'] as const
const changeInstitution = (value: unknown): void => { if (typeof value === 'number') void store.refresh(value) }
onMounted(() => void store.init())
onUnmounted(() => store.destroy())
</script>
<style lang="less">@import './WorkbenchWorkflowsView.less';</style>
