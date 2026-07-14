<script setup lang="ts">
import { computed } from 'vue'
import { Dropdown } from '@arco-design/web-vue'
import { IconDotsVertical, IconStar, IconStarFilled } from '@tabler/icons-vue'
import type { Row } from './record.types'
import { fmtTime, kindClass } from './record.format'
import ActionBody from './ActionBody.vue'
import NetRequestBody from './NetRequestBody.vue'
import NetResponseBody from './NetResponseBody.vue'
import SnapshotBody from './SnapshotBody.vue'
import GenericBody from './GenericBody.vue'

const props = defineProps<{ row: Row; selected?: boolean }>()
defineEmits<{
  (e: 'changed'): void
  (e: 'delete'): void
  (e: 'flag'): void
  (e: 'select'): void
  (e: 'allowlist'): void
  (e: 'blocklist'): void
}>()

// Network rows swap the flag star for a capture-filter menu (allowlist / blocklist this host).
const isNetwork = computed(() => props.row.kind.startsWith('net.'))

// Pick the type-specific body component for this record kind.
const bodyComponent = computed(() => {
  switch (props.row.kind) {
    case 'action':
      return ActionBody
    case 'net.request':
      return NetRequestBody
    case 'net.response':
      return NetResponseBody
    case 'snapshot':
      return SnapshotBody
    default:
      return GenericBody
  }
})
</script>

<template>
  <article
    class="divider-b cursor-pointer border-l-2 px-2.5 py-2 transition [--divider-color:#f3f4f6]"
    :class="selected ? 'border-l-[#165dff] bg-[#f4f8ff]' : 'border-l-transparent bg-white hover:bg-[#fbfcfe]'"
    @click="$emit('select')"
  >
    <!-- header: kind left, time HH:mm:ss + delete right -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-[11px] font-bold uppercase tracking-wide" :class="kindClass(row.kind)">{{ row.kind }}</span>
      <div class="flex shrink-0 items-center gap-2">
        <span class="font-mono text-[11px] text-gray-400">{{ fmtTime(row.ts) }}</span>
        <Dropdown v-if="isNetwork" trigger="click" position="br">
          <button
            type="button"
            class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-[#eaf2ff] hover:text-[#165dff]"
            title="Capture filter for this host"
            @click.stop
          >
            <IconDotsVertical :size="14" />
          </button>
          <template #content>
            <button
              type="button"
              class="block h-8 w-[168px] px-3 text-left text-[12px] font-semibold text-gray-700 hover:bg-[#f3f7ff] hover:text-[#165dff]"
              @click.stop="$emit('allowlist')"
            >
              Add host to allowlist
            </button>
            <button
              type="button"
              class="block h-8 w-[168px] px-3 text-left text-[12px] font-semibold text-gray-700 hover:bg-[#fff1f0] hover:text-red-600"
              @click.stop="$emit('blocklist')"
            >
              Add host to blocklist
            </button>
          </template>
        </Dropdown>
        <button
          v-else
          type="button"
          class="flex h-5 w-5 items-center justify-center rounded transition"
          :class="row.flagged ? 'bg-amber-50 text-amber-500 hover:bg-amber-100' : 'text-gray-400 hover:bg-amber-50 hover:text-amber-500'"
          :title="row.flagged ? 'Unflag key evidence' : 'Flag as key evidence'"
          :aria-pressed="row.flagged"
          @click.stop="$emit('flag')"
        >
          <IconStarFilled v-if="row.flagged" :size="13" />
          <IconStar v-else :size="13" />
        </button>
        <button
          type="button"
          class="flex h-4 w-4 items-center justify-center rounded text-[13px] leading-none text-gray-500 hover:bg-red-50 hover:text-red-600"
          title="Delete this record"
          @click.stop="$emit('delete')"
        >
          ×
        </button>
      </div>
    </div>

    <!-- type-specific body -->
    <component :is="bodyComponent" :row="row" />

    <!-- per-record spec: an operator note consumed at ingest time (Shift+Enter for a newline) -->
    <textarea
      v-model="row.spec"
      placeholder="spec — note for ingest (optional)"
      class="mt-1.5 h-[72px] w-full resize-none rounded border border-gray-200 bg-gray-50/60 px-2 py-1 text-[11px] leading-relaxed text-gray-700 outline-none placeholder:text-gray-400 focus:border-[#165dff] focus:bg-white"
      @click.stop
      @input="$emit('changed')"
      @keydown.enter.exact.prevent
    ></textarea>
  </article>
</template>
