<script setup lang="ts">
import { computed, ref } from 'vue'
import { Drawer, RadioGroup, Radio, Message } from '@arco-design/web-vue'
import type { Row } from './record.types'
import { fmtHeaders, kindClass } from './record.format'

const props = defineProps<{ visible: boolean; rows: Row[]; workflow: string }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

// Concise = type + one-line summary only; Detailed = full per-record content. Spec +
// workflow are shown in BOTH (workflow is docked at the bottom).
const mode = ref<'concise' | 'detailed'>('concise')

// The structured ingest payload — exactly what gets sent to summarizeSkill, projected
// for display. summary = the one-line label; detail = the full content fed to the LLM.
interface RecordView {
  type: string
  summary: string
  detail: string
  spec?: string
  flagged?: boolean
}
function detailText(row: Row): string {
  const parts: string[] = []
  if (row.method) parts.push(`${row.method} ${row.url ?? ''}`.trim())
  else if (row.status !== undefined) parts.push(`${row.status} ${row.url ?? ''}`.trim())
  else if (row.url) parts.push(row.url)
  if (row.headers) parts.push('Headers:\n' + fmtHeaders(row.headers))
  if (row.body) parts.push('Body:\n' + row.body)
  if (row.response) {
    parts.push(`Response ${row.response.status}`)
    if (row.response.headers) parts.push('Response headers:\n' + fmtHeaders(row.response.headers))
    if (row.response.bodyPreview) parts.push('Response body:\n' + row.response.bodyPreview)
  }
  if (row.yaml) parts.push(row.yaml)
  return parts.join('\n\n')
}
const views = computed<RecordView[]>(() =>
  props.rows.map((row) => ({
    type: row.kind,
    summary: row.text,
    detail: detailText(row),
    spec: row.spec.trim() || undefined,
    flagged: row.flagged || undefined
  }))
)

// The full payload as pretty JSON, so the copy button hands over the complete
// ingest data + its structure regardless of the concise/detailed view.
const payloadJson = computed(() =>
  JSON.stringify({ workflow: props.workflow.trim(), records: views.value }, null, 2)
)

async function copyPayload(): Promise<void> {
  try {
    await navigator.clipboard.writeText(payloadJson.value)
    Message.success('Ingest payload copied')
  } catch (err) {
    Message.error('Copy failed: ' + (err as Error).message)
  }
}

function close(): void {
  emit('update:visible', false)
}
</script>

<template>
  <Drawer
    :visible="visible"
    placement="bottom"
    :height="'74%'"
    :header="false"
    :footer="false"
    :body-style="{ padding: '0' }"
    @cancel="close"
  >
    <div class="flex h-full min-h-0 flex-col bg-[#f8fafc]">
      <!-- header: close (left) · title + mode toggle (center) · copy (right) -->
      <div class="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2.5">
        <button
          class="flex h-8 w-8 items-center justify-center rounded-full text-[24px] font-medium leading-none text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          title="Close"
          @click="close"
        >
          ×
        </button>
        <div class="flex min-w-0 flex-col items-center gap-1">
          <span class="text-[13px] font-semibold text-gray-800">Ingest preview · {{ views.length }} records</span>
          <RadioGroup v-model="mode" type="button" size="mini">
            <Radio value="concise">简约</Radio>
            <Radio value="detailed">详尽</Radio>
          </RadioGroup>
        </div>
        <button
          class="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-blue-50 hover:text-[#165dff]"
          title="Copy full ingest payload (JSON)"
          @click="copyPayload"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </button>
      </div>

      <!-- records -->
      <div class="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        <div v-if="!views.length" class="mt-10 text-center text-[12px] text-gray-400">No records to ingest.</div>
        <div
          v-for="(r, i) in views"
          :key="i"
          class="mb-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <div class="flex items-center gap-2">
            <span class="font-mono text-[10px] text-gray-300">#{{ i + 1 }}</span>
            <span v-if="r.flagged" class="rounded bg-amber-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-600">flagged</span>
            <span class="text-[10px] font-bold uppercase tracking-wide" :class="kindClass(r.type)">{{ r.type }}</span>
            <span class="min-w-0 flex-1 truncate text-[12px] text-gray-700">{{ r.summary }}</span>
          </div>
          <pre
            v-if="mode === 'detailed' && r.detail"
            class="m-0 mt-1.5 max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 px-2 py-1 font-mono text-[11px] text-slate-600"
            >{{ r.detail }}</pre
          >
          <div v-if="r.spec" class="mt-1.5 rounded border border-violet-200 bg-violet-50 px-2 py-1">
            <div class="text-[9px] font-bold uppercase tracking-wide text-violet-600">spec</div>
            <div class="whitespace-pre-wrap break-words text-[11px] text-violet-900">{{ r.spec }}</div>
          </div>
        </div>
      </div>

      <!-- workflow: docked at the bottom in both modes -->
      <div class="shrink-0 border-t border-gray-200 bg-white px-3 py-2.5">
        <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Workflow description</div>
        <div
          class="max-h-[88px] overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[12px] leading-relaxed"
          :class="workflow.trim() ? 'text-gray-700' : 'text-gray-400'"
        >
          {{ workflow.trim() || 'No workflow description.' }}
        </div>
      </div>
    </div>
  </Drawer>
</template>
