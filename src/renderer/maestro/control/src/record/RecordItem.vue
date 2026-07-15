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
import './RecordItem.less'

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
    class="record-item"
    :class="{ 'record-item--selected': selected }"
    @click="$emit('select')"
  >
    <!-- header: kind left, time HH:mm:ss + delete right -->
    <div class="record-item__header">
      <span class="record-item__kind" :class="kindClass(row.kind)">{{ row.kind }}</span>
      <div class="record-item__actions">
        <span class="record-item__time">{{ fmtTime(row.ts) }}</span>
        <Dropdown v-if="isNetwork" trigger="click" position="br">
          <button
            type="button"
            class="record-item__filter-button"
            title="Capture filter for this host"
            @click.stop
          >
            <IconDotsVertical :size="14" />
          </button>
          <template #content>
            <button
              type="button"
              class="record-item__filter-option"
              @click.stop="$emit('allowlist')"
            >
              Add host to allowlist
            </button>
            <button
              type="button"
              class="record-item__filter-option record-item__filter-option--danger"
              @click.stop="$emit('blocklist')"
            >
              Add host to blocklist
            </button>
          </template>
        </Dropdown>
        <button
          v-else
          type="button"
          class="record-item__flag-button"
          :class="{ 'record-item__flag-button--active': row.flagged }"
          :title="row.flagged ? 'Unflag key evidence' : 'Flag as key evidence'"
          :aria-pressed="row.flagged"
          @click.stop="$emit('flag')"
        >
          <IconStarFilled v-if="row.flagged" :size="13" />
          <IconStar v-else :size="13" />
        </button>
        <button
          type="button"
          class="record-item__delete-button"
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
      class="record-item__spec"
      @click.stop
      @input="$emit('changed')"
      @keydown.enter.exact.prevent
    ></textarea>
  </article>
</template>
