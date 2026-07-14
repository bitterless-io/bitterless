<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Button, Empty, Message } from '@arco-design/web-vue'
import { IconRefresh, IconTool, IconTrash } from '@tabler/icons-vue'
import type { InjectedButtonDomain } from '@cowork-shared/coach.api'
import { workbenchStore as store } from '../workbench.store'

const domains = computed(() => store.injectedButtons)
const subtitle = computed(() => `${domains.value.length} domain${domains.value.length === 1 ? '' : 's'}`)

const formatTime = (ts: number): string => {
  if (!ts) return '-'
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const removeDomain = async (domain: InjectedButtonDomain): Promise<void> => {
  const result = await store.removeInjectedButtonDomain(domain.domain)
  if (result.ok) {
    const tabText = result.unInjected ? `, removed from ${result.unInjected} open tab${result.unInjected === 1 ? '' : 's'}` : ''
    Message.success(`Removed ${result.domain}${tabText}`)
  } else {
    Message.error(result.error || `Could not remove ${domain.domain}`)
  }
}

onMounted(() => {
  void store.refreshInjectedButtons()
})
</script>

<template>
  <section name="injections" class="flex h-full min-h-0 flex-col bg-white">
    <div name="injections__toolbar" class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-1 pb-3">
      <div name="injections__title" class="flex min-w-0 items-center gap-2">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#eef4ff] text-[#165dff]">
          <IconTool :size="17" stroke="1.8" />
        </span>
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold text-gray-900">Injected Buttons</div>
          <div class="text-[11px] font-medium text-gray-500">{{ subtitle }}</div>
        </div>
      </div>

      <Button name="injections__refresh" size="small" :loading="store.injectedButtonLoading" title="Refresh injected buttons" @click="store.refreshInjectedButtons()">
        <template #icon><IconRefresh :size="15" /></template>
      </Button>
    </div>

    <div name="injections__body" class="min-h-0 flex-1 overflow-auto px-1 pt-3">
      <Empty v-if="!store.injectedButtonLoading && !domains.length" class="mt-12" description="No injected buttons" />
      <div v-else name="injections__list" class="grid gap-2">
        <article
          v-for="domain in domains"
          :key="domain.domain"
          name="injections__domain"
          class="grid gap-3 rounded-md border border-gray-200 bg-[#fbfcfe] px-3 py-3 text-[12px] shadow-[0_1px_0_rgba(15,23,42,0.03)]"
        >
          <div name="injections__domain__header" class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <span class="max-w-full truncate font-mono text-[12px] font-semibold text-gray-900">{{ domain.domain }}</span>
                <span
                  v-if="domain.domain === store.currentDomain"
                  class="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue-700"
                >
                  current
                </span>
              </div>
              <div class="mt-1 text-[11px] font-medium text-gray-500">
                {{ domain.triggers.length }} trigger{{ domain.triggers.length === 1 ? '' : 's' }} · updated {{ formatTime(domain.updatedAt) }}
              </div>
            </div>

            <Button
              name="injections__remove"
              size="small"
              status="danger"
              :loading="store.injectedButtonRemovingDomain === domain.domain"
              :disabled="Boolean(store.injectedButtonRemovingDomain && store.injectedButtonRemovingDomain !== domain.domain)"
              title="Remove saved domain and uninject open tabs"
              @click="removeDomain(domain)"
            >
              <template #icon><IconTrash :size="15" /></template>
              Remove
            </Button>
          </div>

          <div name="injections__triggers" class="grid gap-1.5 md:grid-cols-2">
            <div
              v-for="trigger in domain.triggers"
              :key="`${domain.domain}:${trigger.skillTitle}`"
              name="injections__trigger"
              class="min-w-0 rounded border border-gray-200 bg-white px-2 py-1.5"
            >
              <div class="truncate text-[12px] font-semibold text-gray-900">{{ trigger.skillTitle }}</div>
              <div class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-gray-500">{{ trigger.skillDescription || 'Trigger Cowork' }}</div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
