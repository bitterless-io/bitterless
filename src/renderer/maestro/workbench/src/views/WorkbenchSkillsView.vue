<template>
  <section name="workbench-skills" class="workbench-skills" :class="{ 'workbench-skills--detail': store.skillShowDetail }" @keydown.esc="store.skillShowDetail = false">
    <header name="workbench-skills__context" class="workbench-skills__context">
      <span>{{ store.skillCatalog?.workspace || store.skillsText.defaultWorkspace }}</span>
      <span>{{ store.skillInstitution?.institutionName || store.skillInstitution?.institutionId || store.skillsText.noInstitution }}</span>
    </header>
    <div name="workbench-skills__tabs" class="workbench-skills__tabs" role="tablist" :aria-label="store.skillsText.source">
      <button v-for="(layer, index) in store.skillLayers" :id="'skill-tab-' + layer" :key="layer" name="workbench-skills__tab" type="button" role="tab" class="workbench-skills__tab" :class="{ 'workbench-skills__tab--active': store.skillLayer === layer }" :aria-selected="store.skillLayer === layer" aria-controls="skills-panel" :tabindex="store.skillLayer === layer ? 0 : -1" @click="store.selectSkillLayer(layer)" @keydown="store.moveSkillTab($event, index)">
        {{ store.skillsText[layer] }} <span>{{ store.skillCount(layer) }}</span>
      </button>
    </div>
    <div name="workbench-skills__source" class="workbench-skills__source">
      <div><p>{{ store.skillSourceHint }}</p><code :title="store.skillSourcePath">{{ store.skillSourcePath }}</code></div>
      <Button type="text" size="mini" :title="store.skillsText.open" :aria-label="store.skillsText.open" @click="store.openSkillSource()"><IconFolderOpen :size="17" /></Button>
      <Button v-if="store.skillLayer === 'institution'" type="text" size="mini" :loading="store.skillLoading" @click="store.refreshSkills(true)">{{ store.skillsText.refresh }}</Button>
      <Button v-if="store.skillLayer === 'global'" type="text" size="mini" @click="store.importSkillPackage()">{{ store.skillsText.import }}</Button>
    </div>
    <div v-if="store.skillError || store.skillCatalog?.watchError || store.skillCatalog?.cloudError" class="workbench-skills__error" role="alert">{{ store.skillError || store.skillCatalog?.watchError || store.skillCatalog?.cloudError }}</div>
    <div v-if="store.unassignedCount" class="workbench-skills__migration">
      <Button type="text" size="mini" @click="store.skillShowMigration = !store.skillShowMigration">{{ store.skillsText.migration }} {{ store.unassignedCount }}</Button>
    </div>
    <div id="skills-panel" class="workbench-skills__browser" role="tabpanel" :aria-labelledby="'skill-tab-' + store.skillLayer">
      <aside name="workbench-skills__catalog" class="workbench-skills__catalog">
        <div class="workbench-skills__filters">
          <Input v-model="store.skillSearch" size="mini" allow-clear :placeholder="store.skillsText.search" :aria-label="store.skillsText.search" />
          <Select v-model="store.skillStatus" size="mini" :aria-label="store.skillsText.all"><Option value="all">{{ store.skillsText.all }}</Option><Option value="ready">{{ store.skillsText.ready }}</Option><Option value="error">{{ store.skillsText.error }}</Option></Select>
        </div>
        <div class="workbench-skills__sync" role="status"><IconRefresh :size="13" />{{ (store.skillLoading || store.skillCatalog?.cloudStatus === 'syncing') ? store.skillsText.loading : store.skillsText.synced }}</div>
        <div class="workbench-skills__list">
          <button v-for="skill in store.sourceSkills" :key="skill.reference || skill.id" name="workbench-skills__row" class="workbench-skills__row" :class="{ 'workbench-skills__row--selected': store.selectedSkillId === skill.id }" type="button" :aria-current="store.selectedSkillId === skill.id" @click="store.selectSkill(skill.id)">
            <span class="workbench-skills__row__title"><b>{{ skill.displayName || skill.name }}</b><span :class="{ 'workbench-skills__error': skill.status === 'error' }">{{ skill.status === 'error' ? store.skillsText.error : store.skillsText.ready }}</span></span>
            <span class="workbench-skills__row__description">{{ skill.description || skill.error }}</span>
            <small>{{ skill.path }}</small>
          </button>
          <Empty v-if="!store.sourceSkills.length && !store.skillLoading" :description="store.skillSearch ? store.skillsText.noResults : store.skillsText.empty" />
        </div>
        <p class="workbench-skills__footer">{{ store.skillsText.notice }}</p>
      </aside>
      <article name="workbench-skills__detail" class="workbench-skills__detail">
        <Button class="workbench-skills__back" type="text" size="mini" @click="store.skillShowDetail = false">{{ store.skillsText.back }}</Button>
        <Empty v-if="!store.selectedSkill" :description="store.skillsText.select" />
        <template v-else>
          <header class="workbench-skills__heading"><h2>{{ store.selectedSkill.displayName || store.selectedSkill.name }}</h2><span class="workbench-skills__badge">{{ store.selectedSkill.status === 'error' ? store.skillsText.error : store.skillsText.ready }}</span></header>
          <p class="workbench-skills__description">{{ store.selectedSkill.description }}</p>
          <p v-if="store.selectedSkill.scope === 'unassigned'" class="workbench-skills__notice">{{ store.skillsText.migrationHint }}<Button type="text" size="mini" @click="store.assignGlobalSkill()">{{ store.skillsText.assign }}</Button></p>
          <dl class="workbench-skills__metadata"><div><dt>{{ store.skillsText.source }}</dt><dd>{{ store.skillsText[store.selectedSkill.layer || 'global'] }} <span v-if="store.selectedSkill.readonly"> · {{ store.skillsText.readonly }}</span></dd></div><div><dt>{{ store.skillsText.path }}</dt><dd><code>{{ store.selectedSkill.path }}</code></dd></div><div><dt>{{ store.skillsText.updated }}</dt><dd>{{ new Date(store.selectedSkill.updatedAt).toLocaleString() }}</dd></div></dl>
          <div class="workbench-skills__actions">
            <Button type="text" size="mini" :disabled="store.selectedSkill.status === 'error'" @click="store.copySkillReference()"><IconCopy :size="15" /> {{ store.skillsText.copy }}</Button>
            <Button type="text" size="mini" @click="store.openSkillFile()">{{ store.skillsText.openFile }}</Button>
            <Button type="text" size="mini" :title="store.skillsText.open" :aria-label="store.skillsText.open" @click="store.openSelectedSkillDirectory()"><IconFolderOpen :size="16" /></Button>
            <template v-if="store.selectedSkill.layer === 'global' && !store.selectedSkill.readonly"><Button type="text" size="mini" @click="store.exportSelectedSkillPackage()">{{ store.skillsText.export }}</Button><Button type="text" status="danger" size="mini" @click="store.removeSkill()">{{ store.skillsText.delete }}</Button></template>
          </div>
          <div v-if="store.selectedSkill.error" class="workbench-skills__error" role="alert">{{ store.selectedSkill.error }}<p>{{ store.skillsText.noBody }}</p></div>
          <section v-if="store.skillDetail?.body" class="workbench-skills__body"><h3>{{ store.skillsText.body }}</h3><div v-html="renderMarkdown(store.skillDetail.body)"></div></section>
          <details v-if="store.skillDetail?.files?.length" class="workbench-skills__diagnostic"><summary>{{ store.skillsText.files }} {{ store.skillDetail.files.length }}</summary><ul><li v-for="file in store.skillDetail.files" :key="file"><code>{{ file }}</code></li></ul></details>
          <details class="workbench-skills__diagnostic"><summary>{{ store.skillsText.diagnostics }}</summary><dl><dt>Reference</dt><dd><code>{{ store.selectedSkill.reference }}</code></dd><dt>catalogRevision</dt><dd><code>{{ store.skillCatalog?.revision }}</code></dd><dt>skillRevision</dt><dd><code>{{ store.selectedSkill.skillRevision }}</code></dd><dt>Real path</dt><dd><code>{{ store.selectedSkill.realPath }}</code></dd></dl></details>
        </template>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Button, Empty, Input, Select, Option } from '@arco-design/web-vue'
import { IconCopy, IconFolderOpen, IconRefresh } from '@tabler/icons-vue'
import { renderMarkdown } from '@maestro-renderer/control/src/markdown'
import { workbenchStore as store } from '../workbench.store'
</script>

<style lang="less">
@import './WorkbenchSkillsView.less';
</style>
