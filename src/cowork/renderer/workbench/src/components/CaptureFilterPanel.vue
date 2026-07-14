<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Button, Message, Modal, Option, Select, Switch, Textarea } from '@arco-design/web-vue'
import { IconX } from '@tabler/icons-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { ConfigApi } from '@cowork-shared/config.api'
import { CAPTURE_DOMAIN, CAPTURE_WHITELIST_ENABLED_KEY } from '@cowork-shared/config.api'
import type { CaptureFilterApi, CaptureRule } from '@cowork-shared/captureFilter.api'
import { captureConfig } from '@cowork-renderer/control/src/config/captureConfig.store'

const config = createXpcRendererEmitter<ConfigApi>('ConfigDao') as ConfigApi
const filterApi = createXpcRendererEmitter<CaptureFilterApi>('CaptureFilterDao') as CaptureFilterApi

const whitelist = ref<CaptureRule[]>([])
const blacklist = ref<CaptureRule[]>([])
const whitelistEnabled = ref(false)
const loading = ref(true)
const saving = ref(false)
const importVisible = ref(false)
const importText = ref('')
const emit = defineEmits<{ saved: [] }>()

const load = async (): Promise<void> => {
  loading.value = true
  try {
    const [rules, toggle] = await Promise.all([
      filterApi.listAll(),
      config.get({ domain: CAPTURE_DOMAIN, key: CAPTURE_WHITELIST_ENABLED_KEY })
    ])
    whitelist.value = rules
      .filter((rule) => rule.type === 'whitelist')
      .map((rule) => ({ type: 'whitelist', rule: rule.rule, value: rule.value }))
    blacklist.value = rules
      .filter((rule) => rule.type === 'blacklist')
      .map((rule) => ({ type: 'blacklist', rule: rule.rule, value: rule.value }))
    whitelistEnabled.value = toggle?.options === true
  } catch (err) {
    Message.error('Load failed: ' + (err as Error).message)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const addWhite = (): void => {
  whitelist.value.push({ type: 'whitelist', rule: 'domain-suffix', value: '' })
}

const addBlack = (): void => {
  blacklist.value.push({ type: 'blacklist', rule: 'domain-suffix', value: '' })
}

const removeWhite = (index: number): void => {
  whitelist.value.splice(index, 1)
}

const removeBlack = (index: number): void => {
  blacklist.value.splice(index, 1)
}

const toPayload = (): { whitelistEnabled: boolean; whitelist: { rule: string; value: string }[]; blacklist: { rule: string; value: string }[] } => ({
  whitelistEnabled: whitelistEnabled.value,
  whitelist: whitelist.value.map((rule) => ({ rule: rule.rule, value: rule.value.trim() })).filter((rule) => rule.value),
  blacklist: blacklist.value.map((rule) => ({ rule: rule.rule, value: rule.value.trim() })).filter((rule) => rule.value)
})

const exportJson = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(toPayload(), null, 2))
    Message.success('Network filter copied')
  } catch (err) {
    Message.error('Copy failed: ' + (err as Error).message)
  }
}

const parseRules = (input: unknown, type: CaptureRule['type']): CaptureRule[] => {
  if (!Array.isArray(input)) return []
  const out: CaptureRule[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const value = (item as { value?: unknown }).value
    if (typeof value !== 'string' || !value.trim()) continue
    const rule = (item as { rule?: unknown }).rule === 'url-prefix' ? 'url-prefix' : 'domain-suffix'
    out.push({ type, rule, value: value.trim() })
  }
  return out
}

const doImport = (): boolean => {
  let data: unknown
  try {
    data = JSON.parse(importText.value)
  } catch {
    Message.error('Invalid JSON')
    return false
  }
  if (!data || typeof data !== 'object') {
    Message.error('Expected a JSON object')
    return false
  }
  const parsed = data as Record<string, unknown>
  whitelist.value = parseRules(parsed.whitelist, 'whitelist')
  blacklist.value = parseRules(parsed.blacklist, 'blacklist')
  whitelistEnabled.value = parsed.whitelistEnabled === true
  importText.value = ''
  Message.success('Imported')
  return true
}

const save = async (): Promise<void> => {
  if (saving.value || loading.value) return
  saving.value = true
  try {
    const rules: CaptureRule[] = [
      ...whitelist.value.map((rule) => ({ type: 'whitelist' as const, rule: rule.rule, value: rule.value.trim() })),
      ...blacklist.value.map((rule) => ({ type: 'blacklist' as const, rule: rule.rule, value: rule.value.trim() }))
    ].filter((rule) => rule.value)
    await filterApi.replaceAll({ rules })
    await config.upsert({ domain: CAPTURE_DOMAIN, key: CAPTURE_WHITELIST_ENABLED_KEY, options: whitelistEnabled.value })
    await captureConfig.load()
    emit('saved')
    Message.success('Network filter saved')
  } catch (err) {
    Message.error('Save failed: ' + (err as Error).message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-[#f8fafc]">
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
      <span class="text-[12px] font-semibold text-gray-800">Network filter</span>
      <div class="flex items-center gap-1.5">
        <Button size="mini" :disabled="loading" @click="exportJson">Export</Button>
        <Button size="mini" :disabled="loading" @click="importVisible = true">Import</Button>
        <Button type="primary" size="mini" :loading="saving" :disabled="loading" @click="save">Save</Button>
      </div>
    </div>

    <div class="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
          <div class="flex min-w-0 items-center gap-2">
            <span class="text-[11px] font-bold uppercase tracking-wide text-gray-600">Allowlist</span>
            <Switch v-model="whitelistEnabled" size="small" />
          </div>
          <Button size="mini" @click="addWhite">+ Rule</Button>
        </div>

        <div class="space-y-1.5 p-2">
          <div v-if="!whitelist.length" class="rounded border border-dashed border-gray-200 px-2.5 py-2 text-[11px] text-gray-400">
            No allowlist rules
          </div>
          <div v-for="(rule, index) in whitelist" :key="'w' + index" class="flex items-center gap-1.5">
            <Select v-model="rule.rule" size="mini" class="shrink-0" :style="{ width: '116px' }" title="Match type">
              <Option value="domain-suffix">domain</Option>
              <Option value="url-prefix">url</Option>
            </Select>
            <input
              v-model="rule.value"
              placeholder="micromeet.ai"
              class="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px] outline-none focus:border-[#165dff]"
            />
            <button
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
              title="Remove rule"
              type="button"
              @click="removeWhite(index)"
            >
              <IconX :size="14" stroke="1.9" />
            </button>
          </div>
        </div>
      </section>

      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
          <span class="text-[11px] font-bold uppercase tracking-wide text-gray-600">Blocklist</span>
          <Button size="mini" @click="addBlack">+ Rule</Button>
        </div>

        <div class="space-y-1.5 p-2">
          <div v-if="!blacklist.length" class="rounded border border-dashed border-gray-200 px-2.5 py-2 text-[11px] text-gray-400">
            No blocklist rules
          </div>
          <div v-for="(rule, index) in blacklist" :key="'b' + index" class="flex items-center gap-1.5">
            <Select v-model="rule.rule" size="mini" class="shrink-0" :style="{ width: '116px' }" title="Match type">
              <Option value="domain-suffix">domain</Option>
              <Option value="url-prefix">url</Option>
            </Select>
            <input
              v-model="rule.value"
              placeholder="https://host/ping"
              class="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-[12px] outline-none focus:border-[#165dff]"
            />
            <button
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
              title="Remove rule"
              type="button"
              @click="removeBlack(index)"
            >
              <IconX :size="14" stroke="1.9" />
            </button>
          </div>
        </div>
      </section>
    </div>

    <Modal
      v-model:visible="importVisible"
      title="Import network filter"
      :width="520"
      ok-text="Import"
      unmount-on-close
      :on-before-ok="doImport"
      @cancel="importText = ''"
    >
      <Textarea
        v-model="importText"
        placeholder='{ "whitelistEnabled": false, "whitelist": [ { "rule": "domain-suffix", "value": "micromeet.ai" } ], "blacklist": [] }'
        :auto-size="{ minRows: 8, maxRows: 16 }"
      />
    </Modal>
  </div>
</template>
