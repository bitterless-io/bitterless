<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Button, Empty, Message } from '@arco-design/web-vue'
import { IconRefresh, IconTool, IconTrash } from '@tabler/icons-vue'
import type { InjectedButtonDomain } from '@maestro-shared/coach.api'
import { workbenchStore as store } from '../workbench.store'
import './WorkbenchInjectionsView.less'

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
  <section name="injections" class="workbench-injections">
    <div name="injections__toolbar" class="workbench-injections__toolbar">
      <div name="injections__title" class="workbench-injections__title">
        <span class="workbench-injections__title__icon">
          <IconTool :size="17" stroke="1.8" />
        </span>
        <div class="workbench-injections__title__body">
          <div class="workbench-injections__title__heading">Injected Buttons</div>
          <div class="workbench-injections__title__subtitle">{{ subtitle }}</div>
        </div>
      </div>

      <Button name="injections__refresh" size="small" :loading="store.injectedButtonLoading" title="Refresh injected buttons" @click="store.refreshInjectedButtons()">
        <template #icon><IconRefresh :size="15" /></template>
      </Button>
    </div>

    <div name="injections__body" class="workbench-injections__body">
      <Empty v-if="!store.injectedButtonLoading && !domains.length" class="workbench-injections__empty" description="No injected buttons" />
      <div v-else name="injections__list" class="workbench-injections__list">
        <article
          v-for="domain in domains"
          :key="domain.domain"
          name="injections__domain"
          class="workbench-injections__domain"
        >
          <div name="injections__domain__header" class="workbench-injections__domain__header">
            <div class="workbench-injections__domain__identity">
              <div class="workbench-injections__domain__name-row">
                <span class="workbench-injections__domain__name">{{ domain.domain }}</span>
                <span
                  v-if="domain.domain === store.currentDomain"
                  class="workbench-injections__domain__current"
                >
                  current
                </span>
              </div>
              <div class="workbench-injections__domain__meta">
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

          <div name="injections__triggers" class="workbench-injections__triggers">
            <div
              v-for="trigger in domain.triggers"
              :key="`${domain.domain}:${trigger.skillTitle}`"
              name="injections__trigger"
              class="workbench-injections__trigger"
            >
              <div class="workbench-injections__trigger__title">{{ trigger.skillTitle }}</div>
              <div class="workbench-injections__trigger__description">{{ trigger.skillDescription || 'Trigger Maestro' }}</div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
