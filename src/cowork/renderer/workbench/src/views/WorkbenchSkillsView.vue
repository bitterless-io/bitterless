<script setup lang="ts">
import { Button, Empty, Message, Tag } from '@arco-design/web-vue'
import { IconFolderOpen } from '@tabler/icons-vue'
import { renderMarkdown } from '@cowork-renderer/control/src/markdown'
import { workbenchStore as store } from '../workbench.store'

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
  <section class="grid h-full min-h-0 grid-cols-[160px_240px_minmax(0,1fr)] bg-white">
    <div class="min-h-0 overflow-auto border-r border-gray-200 bg-[#f6f8fb]">
      <div class="border-b border-gray-200 px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">Domains</div>
      <button
        v-for="domain in store.domains"
        :key="domain.domain"
        type="button"
        class="block w-full border-b border-gray-200 px-3 py-2 text-left"
        :class="store.selectedDomain === domain.domain || (!store.selectedDomain && domain.domain === 'all domains') ? 'bg-white text-[#165dff]' : 'text-gray-600 hover:bg-white/70'"
        @click="store.selectDomain(domain.domain)"
      >
        <span class="block truncate text-[12px] font-medium" :title="domain.domain">{{ domain.domain }}</span>
        <span class="mt-0.5 block text-[10px]" :class="domain.active ? 'text-[#165dff]' : 'text-gray-400'">
          {{ domain.count }} skills{{ domain.active ? ' · active' : '' }}
        </span>
      </button>
      <Empty v-if="!store.domains.length" class="mt-8" description="No domains" />
    </div>

    <div class="min-h-0 overflow-auto border-r border-gray-200 bg-[#eef2f5]">
      <div class="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <span class="truncate text-[11px] font-semibold uppercase text-gray-500" :title="store.selectedDomain || store.currentDomain">
          {{ store.selectedDomain || 'all domains' }}
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <Button type="text" size="mini" @click="importSkillPackage">Import</Button>
          <button
            type="button"
            :title="store.selectedDomain ? `Open ${store.selectedDomain} skills folder` : 'Open skills folder'"
            aria-label="Open skills folder"
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition hover:bg-white hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
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
        class="block w-full border-b border-gray-200 p-3 text-left"
        :class="store.selectedSkillId === skill.id ? 'bg-white' : 'hover:bg-white/60'"
        @click="store.selectSkill(skill.id)"
      >
        <b class="block truncate text-[13px] text-gray-900">{{ skill.name }}</b>
        <span class="mt-1 block text-[11px] text-gray-500">{{ skillSourceLabel(skill.source) }} · {{ skill.inputs.length }} inputs</span>
      </button>
      <Empty
        v-if="!store.domainSkills.length"
        class="mt-8"
        :description="store.selectedDomain ? `No skills for ${store.selectedDomain}` : 'No skills yet'"
      />
    </div>

    <div class="min-h-0 overflow-auto bg-white p-4">
      <Empty v-if="!store.selectedSkill" class="mt-10" description="Select a skill" />
      <template v-else>
        <div class="mb-1 flex items-start justify-between gap-3">
          <h2 class="m-0 min-w-0 text-[17px] font-semibold text-gray-900">{{ store.selectedSkill.name }}</h2>
          <div class="flex shrink-0 items-center gap-1">
            <Button type="text" size="mini" :disabled="!store.selectedSkillId" @click="exportSelectedSkillPackage">Export</Button>
            <button
              type="button"
              title="Open skill folder"
              aria-label="Open skill folder"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 transition hover:bg-[#f4f7fb] hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
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
        <p class="mb-2 leading-relaxed text-gray-500">{{ store.selectedSkill.description }}</p>
        <div
          v-if="store.skillDetail?.externalOnly"
          class="mb-3 rounded-md border border-sky-200 bg-sky-50 p-2.5 text-[12px] leading-5 text-sky-900"
        >
          External markdown skill. Coach can read and edit it, but it has no runtime recipe yet.
        </div>
        <div v-if="store.selectedSkill.triggers.length" class="mb-1.5 flex flex-wrap gap-1.5">
          <Tag v-for="trigger in store.selectedSkill.triggers" :key="trigger" size="small">{{ trigger }}</Tag>
        </div>
        <div v-if="store.selectedSkill.inputs.length" class="mb-2.5 flex flex-wrap gap-1.5">
          <Tag v-for="input in store.selectedSkill.inputs" :key="input.name" color="arcoblue" size="small">{{ input.name }}</Tag>
        </div>
        <div v-if="store.skillDetail?.fieldRules" class="mb-3 rounded-md border border-violet-200 bg-violet-50 p-2.5">
          <div class="mb-1 text-[11px] font-bold uppercase text-violet-700">Field rules</div>
          <pre class="m-0 whitespace-pre-wrap break-words font-mono text-[12px] text-violet-900">{{ store.skillDetail.fieldRules }}</pre>
        </div>
        <div
          v-if="store.skillDetail?.audit?.issues.length"
          class="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2.5"
        >
          <div class="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-800">
            <span>Skill audit</span>
            <Tag size="small" :color="store.skillDetail.audit.ok ? 'orange' : 'red'">{{ store.skillDetail.audit.ok ? 'warnings' : 'errors' }}</Tag>
          </div>
          <div class="space-y-1">
            <div
              v-for="issue in store.skillDetail.audit.issues"
              :key="`${issue.code}:${issue.path || ''}:${issue.message}`"
              class="rounded bg-white/70 px-2 py-1 text-[12px] text-amber-950"
            >
              <b class="mr-1">{{ issue.severity }}</b>
              <span>{{ issue.message }}</span>
              <code v-if="issue.path" class="ml-1 text-[11px] text-amber-700">{{ issue.path }}</code>
            </div>
          </div>
        </div>
        <div
          v-if="store.skillDetail?.body"
          class="md mb-3 max-h-[420px] overflow-auto rounded-md border border-gray-200 bg-[#fbfcfe] p-3"
          v-html="renderMarkdown(store.skillDetail.body)"
        ></div>
      </template>
    </div>
  </section>
</template>
