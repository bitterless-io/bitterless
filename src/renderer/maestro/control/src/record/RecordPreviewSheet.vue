<script setup lang="ts">
import { computed, ref } from 'vue'
import { Drawer, RadioGroup, Radio, Message } from '@arco-design/web-vue'
import type { Row } from './record.types'
import { fmtHeaders, kindClass } from './record.format'
import './RecordPreviewSheet.less'

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
    <div class="record-preview">
      <!-- header: close (left) · title + mode toggle (center) · copy (right) -->
      <div class="record-preview__header">
        <button
          class="record-preview__close"
          title="Close"
          @click="close"
        >
          ×
        </button>
        <div class="record-preview__heading">
          <span class="record-preview__title">Ingest preview · {{ views.length }} records</span>
          <RadioGroup v-model="mode" type="button" size="mini">
            <Radio value="concise">简约</Radio>
            <Radio value="detailed">详尽</Radio>
          </RadioGroup>
        </div>
        <button
          class="record-preview__copy"
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
      <div class="record-preview__records">
        <div v-if="!views.length" class="record-preview__empty">No records to ingest.</div>
        <div
          v-for="(r, i) in views"
          :key="i"
          class="record-preview__card"
        >
          <div class="record-preview__card-header">
            <span class="record-preview__index">#{{ i + 1 }}</span>
            <span v-if="r.flagged" class="record-preview__flag">flagged</span>
            <span class="record-preview__kind" :class="kindClass(r.type)">{{ r.type }}</span>
            <span class="record-preview__summary">{{ r.summary }}</span>
          </div>
          <pre
            v-if="mode === 'detailed' && r.detail"
            class="record-preview__detail"
            >{{ r.detail }}</pre
          >
          <div v-if="r.spec" class="record-preview__spec">
            <div class="record-preview__spec-label">spec</div>
            <div class="record-preview__spec-content">{{ r.spec }}</div>
          </div>
        </div>
      </div>

      <!-- workflow: docked at the bottom in both modes -->
      <div class="record-preview__workflow">
        <div class="record-preview__workflow-label">Workflow description</div>
        <div
          class="record-preview__workflow-content"
          :class="{ 'record-preview__workflow-content--empty': !workflow.trim() }"
        >
          {{ workflow.trim() || 'No workflow description.' }}
        </div>
      </div>
    </div>
  </Drawer>
</template>
