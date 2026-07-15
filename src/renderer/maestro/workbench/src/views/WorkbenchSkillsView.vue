<script setup lang="ts">
import { Button, Empty, Message, Tag } from '@arco-design/web-vue'
import { IconFolderOpen } from '@tabler/icons-vue'
import { renderMarkdown } from '@maestro-renderer/control/src/markdown'
import { workbenchStore as store } from '../workbench.store'
import './WorkbenchSkillsView.less'

const openSelectedSkillDirectory = async (): Promise<void> => {
  const result = await store.openSelectedSkillDirectory()
  if (!result.ok) Message.error(result.error || 'Could not open skill folder')
}

const exportSelectedSkillPackage = async (): Promise<void> => {
  const result = await store.exportSelectedSkillPackage()
  if (result.canceled) return
  if (result.ok) Message.success(result.message)
  else Message.error(result.error || result.message || 'Could not export skill')
}

const importSkillPackage = async (): Promise<void> => {
  const result = await store.importSkillPackage()
  if (result.canceled) return
  if (result.ok) Message.success(result.message)
  else Message.error(result.error || result.message || 'Could not import skill')
}

const openDomainDirectory = async (): Promise<void> => {
  const result = await store.openDomainDirectory()
  if (!result.ok) Message.error(result.error || 'Could not open skills folder')
}

const deleteSelectedSkill = async (): Promise<void> => {
  const skill = store.selectedSkill
  if (!skill || skill.source === 'builtin') return
  if (!confirm(`Delete skill "${skill.name}"?`)) return
  const result = await store.deleteSelectedSkill()
  if (result.ok) Message.success(result.message)
  else Message.error(result.message)
}

const skillSourceLabel = (source: string): string => {
  if (source === 'recording') return 'capture'
  if (source === 'external') return 'external'
  return source
}
</script>

<template>
  <section class="workbench-skills">
    <div class="workbench-skills__domains">
      <div class="workbench-skills__domains__title">Domains</div>
      <button
        v-for="domain in store.domains"
        :key="domain.domain"
        type="button"
        class="workbench-skills__domain"
        :class="{ 'workbench-skills__domain--active': store.selectedDomain === domain.domain || (!store.selectedDomain && domain.domain === 'all domains') }"
        @click="store.selectDomain(domain.domain)"
      >
        <span class="workbench-skills__domain__name" :title="domain.domain">{{ domain.domain }}</span>
        <span class="workbench-skills__domain__meta" :class="{ 'workbench-skills__domain__meta--active': domain.active }">
          {{ domain.count }} skills{{ domain.active ? ' · active' : '' }}
        </span>
      </button>
      <Empty v-if="!store.domains.length" class="workbench-skills__empty" description="No domains" />
    </div>

    <div class="workbench-skills__catalog">
      <div class="workbench-skills__catalog__header">
        <span class="workbench-skills__catalog__title" :title="store.selectedDomain || store.currentDomain">
          {{ store.selectedDomain || 'all domains' }}
        </span>
        <div class="workbench-skills__catalog__actions">
          <Button type="text" size="mini" @click="importSkillPackage">Import</Button>
          <button
            type="button"
            :title="store.selectedDomain ? `Open ${store.selectedDomain} skills folder` : 'Open skills folder'"
            aria-label="Open skills folder"
            class="workbench-skills__icon-action workbench-skills__icon-action--small"
            :disabled="!store.domainSkills.length"
            @click="openDomainDirectory"
          >
            <IconFolderOpen :size="15" stroke="1.8" />
          </button>
        </div>
      </div>
      <button
        v-for="skill in store.domainSkills"
        :key="skill.id"
        type="button"
        class="workbench-skills__skill"
        :class="{ 'workbench-skills__skill--active': store.selectedSkillId === skill.id }"
        @click="store.selectSkill(skill.id)"
      >
        <b class="workbench-skills__skill__name">{{ skill.name }}</b>
        <span class="workbench-skills__skill__meta">{{ skillSourceLabel(skill.source) }} · {{ skill.inputs.length }} inputs</span>
      </button>
      <Empty
        v-if="!store.domainSkills.length"
        class="workbench-skills__empty"
        :description="store.selectedDomain ? `No skills for ${store.selectedDomain}` : 'No skills yet'"
      />
    </div>

    <div class="workbench-skills__detail">
      <Empty v-if="!store.selectedSkill" class="workbench-skills__detail__empty" description="Select a skill" />
      <template v-else>
        <div class="workbench-skills__detail__header">
          <h2 class="workbench-skills__detail__title">{{ store.selectedSkill.name }}</h2>
          <div class="workbench-skills__detail__actions">
            <Button type="text" size="mini" :disabled="!store.selectedSkillId" @click="exportSelectedSkillPackage">Export</Button>
            <button
              type="button"
              title="Open skill folder"
              aria-label="Open skill folder"
              class="workbench-skills__icon-action"
              :disabled="!store.selectedSkillId"
              @click="openSelectedSkillDirectory"
            >
              <IconFolderOpen :size="16" stroke="1.8" />
            </button>
            <Button
              type="text"
              status="danger"
              size="mini"
              :disabled="!store.selectedSkill || store.selectedSkill.source === 'builtin'"
              @click="deleteSelectedSkill"
            >
              Delete
            </Button>
          </div>
        </div>
        <p class="workbench-skills__description">{{ store.selectedSkill.description }}</p>
        <div
          v-if="store.skillDetail?.externalOnly"
          class="workbench-skills__notice workbench-skills__notice--external"
        >
          External markdown skill. Coach can read and edit it, but it has no runtime recipe yet.
        </div>
        <div v-if="store.selectedSkill.triggers.length" class="workbench-skills__tags workbench-skills__tags--triggers">
          <Tag v-for="trigger in store.selectedSkill.triggers" :key="trigger" size="small">{{ trigger }}</Tag>
        </div>
        <div v-if="store.selectedSkill.inputs.length" class="workbench-skills__tags workbench-skills__tags--inputs">
          <Tag v-for="input in store.selectedSkill.inputs" :key="input.name" color="arcoblue" size="small">{{ input.name }}</Tag>
        </div>
        <div v-if="store.skillDetail?.fieldRules" class="workbench-skills__rules">
          <div class="workbench-skills__rules__title">Field rules</div>
          <pre class="workbench-skills__rules__content">{{ store.skillDetail.fieldRules }}</pre>
        </div>
        <div
          v-if="store.skillDetail?.audit?.issues.length"
          class="workbench-skills__audit"
        >
          <div class="workbench-skills__audit__header">
            <span>Skill audit</span>
            <Tag size="small" :color="store.skillDetail.audit.ok ? 'orange' : 'red'">{{ store.skillDetail.audit.ok ? 'warnings' : 'errors' }}</Tag>
          </div>
          <div class="workbench-skills__audit__list">
            <div
              v-for="issue in store.skillDetail.audit.issues"
              :key="`${issue.code}:${issue.path || ''}:${issue.message}`"
              class="workbench-skills__audit__issue"
            >
              <b class="workbench-skills__audit__severity">{{ issue.severity }}</b>
              <span>{{ issue.message }}</span>
              <code v-if="issue.path" class="workbench-skills__audit__path">{{ issue.path }}</code>
            </div>
          </div>
        </div>
        <div
          v-if="store.skillDetail?.body"
          class="workbench-skills__markdown"
          v-html="renderMarkdown(store.skillDetail.body)"
        ></div>
      </template>
    </div>
  </section>
</template>
