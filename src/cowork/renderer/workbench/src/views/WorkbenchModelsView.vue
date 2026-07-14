<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Button, Dropdown, Empty, Option, Select } from '@arco-design/web-vue'
import { IconCircleCheckFilled, IconCircleDashed, IconCpu, IconGauge, IconLogin2, IconLogout, IconPercentage } from '@tabler/icons-vue'
import type { LlmEffort, LlmLoginMethod } from '@cowork-shared/coach.api'
import { workbenchStore as store } from '../workbench.store'

const activeGroup = computed(() => store.activeLlmGroup)
const activeModel = computed(() => store.activeLlmModel)
const modelValue = computed(() => store.activeLlmModel?.model || '')
const effortValue = computed(() => store.llmConfig?.effort || store.activeLlmModel?.effort || 'default')
const effortDisabled = computed(() => store.activeLlmEfforts.length <= 1 && store.activeLlmEfforts[0]?.id === 'default')
const compressionRemainingValue = computed(() => store.activeLlmModel?.compressionRemainingPercent ?? 10)
const compressionTriggerUsed = computed(() => Math.max(10, 100 - compressionRemainingValue.value))
const activeProviderLabel = computed(() => {
  const cfg = store.llmConfig
  if (!cfg?.provider) return '--'
  return cfg.providers.find((item) => item.provider === cfg.provider)?.label || cfg.provider || '--'
})
const activeModelLabel = computed(() => {
  const cfg = store.llmConfig
  if (!cfg?.provider || !cfg.model) return '--'
  return cfg.presets.find((item) => item.provider === cfg.provider && item.model === cfg.model)?.label || cfg.model || '--'
})
const activeEffortLabel = computed(() => {
  const cfg = store.llmConfig
  if (!cfg?.provider || !cfg.model || !cfg.effort) return '--'
  const preset = cfg.presets.find((item) => item.provider === cfg.provider && item.model === cfg.model)
  return preset?.efforts.find((item) => item.id === cfg.effort)?.label || cfg.effort || '--'
})
const authStatusLabel = computed(() => {
  const label = activeGroup.value?.label || '--'
  return activeGroup.value?.ready ? `${label} logged in` : `${label} not logged in`
})

const toEffort = (value: unknown): LlmEffort => {
  const id = String(value || 'default') as LlmEffort
  return store.activeLlmEfforts.some((item) => item.id === id) ? id : store.activeLlmModel?.effort || 'default'
}

const login = (method: LlmLoginMethod = 'browser'): void => {
  void store.loginLlmProvider(activeGroup.value?.provider, method)
}

const logout = (): void => {
  void store.logoutLlmProvider(activeGroup.value?.provider)
}

const setCompressionRemaining = (event: Event): void => {
  const el = event.target as HTMLInputElement
  void store.setLlmCompressionRemainingPercent(Number(el.value))
}

onMounted(() => {
  void store.refreshLlmConfig()
})
</script>

<template>
  <section name="models" class="flex h-full min-h-0 flex-col bg-white">
    <div name="models__active" class="shrink-0">
      <div name="models__active__card" class="rounded-md border border-gray-200 bg-[#fbfcfe] px-4 py-3">
        <div name="models__active__title" class="mb-2 text-[11px] font-semibold uppercase text-gray-500">Active Model</div>
        <div name="models__active__fields" class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div name="models__active__provider" class="min-w-[140px]">
            <div name="models__active__provider__label" class="text-[11px] text-gray-500">Provider</div>
            <div name="models__active__provider__value" class="mt-0.5 truncate text-[17px] font-semibold text-gray-900">
              {{ activeProviderLabel }}
            </div>
          </div>
          <div name="models__active__model" class="min-w-[180px]">
            <div name="models__active__model__label" class="text-[11px] text-gray-500">Model</div>
            <div name="models__active__model__value" class="mt-0.5 truncate text-[17px] font-semibold text-gray-900">
              {{ activeModelLabel }}
            </div>
          </div>
          <div name="models__active__effort" class="min-w-[110px]">
            <div name="models__active__effort__label" class="text-[11px] text-gray-500">Effort</div>
            <div name="models__active__effort__value" class="mt-0.5 truncate text-[17px] font-semibold text-gray-900">
              {{ activeEffortLabel }}
            </div>
          </div>
          <div name="models__active__compression" class="min-w-[130px]">
            <div name="models__active__compression__label" class="text-[11px] text-gray-500">Compression</div>
            <div class="mt-0.5 truncate text-[17px] font-semibold text-gray-900">{{ compressionRemainingValue }}% left</div>
          </div>
        </div>
      </div>
    </div>

    <div name="models__body" class="mt-3 grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] gap-3">
      <div name="models__providers" class="min-h-0 overflow-auto rounded-md border border-gray-200 bg-[#f6f8fb]">
        <div name="models__providers__title" class="border-b border-gray-200 px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
          Providers
        </div>
        <button
          v-for="group in store.llmProviderGroups"
          :key="group.provider"
          name="models__providers__row"
          type="button"
          class="block w-full border-b border-gray-200 px-3 py-2.5 text-left transition"
          :class="group.active ? 'bg-white text-[#165dff]' : 'text-gray-600 hover:bg-white/70'"
          :disabled="store.llmSaving || store.llmLoading"
          @click="store.setLlmProvider(group.provider)"
        >
          <span class="flex min-w-0 items-center justify-between gap-2">
            <span class="truncate text-[12px] font-semibold">{{ group.label }}</span>
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="group.ready ? 'bg-emerald-500' : 'bg-gray-300'"
              :title="group.ready ? 'Signed in' : 'Not signed in'"
            />
          </span>
        </button>
        <Empty v-if="!store.llmProviderGroups.length" class="mt-8" description="No providers" />
      </div>

      <div name="models__detail" class="min-h-0 overflow-auto bg-white">
        <Empty v-if="store.llmLoading" class="mt-10" description="Loading models" />
        <Empty v-else-if="!store.llmConfig || !activeGroup || !activeModel" class="mt-10" description="No models" />
        <template v-else>
          <div name="models__detail__content" class="max-w-[760px]">
            <div name="models__detail__auth" class="mb-5 flex min-h-11 items-center justify-between gap-3 rounded-md border border-gray-200 bg-[#fbfcfe] px-4 py-2">
              <div name="models__detail__auth__body" class="flex min-w-0 items-center self-stretch">
                <div name="models__detail__auth__title" class="flex h-full min-h-7 items-center gap-2 text-[13px] font-semibold leading-none text-gray-900">
                  <IconCircleCheckFilled
                    v-if="activeGroup.ready"
                    :size="17"
                    class="shrink-0 text-emerald-500"
                    title="登录成功"
                  />
                  <IconCircleDashed
                    v-else
                    :size="17"
                    stroke="1.8"
                    class="shrink-0 text-gray-400"
                    title="未登录"
                  />
                  <span class="truncate">{{ authStatusLabel }}</span>
                </div>
              </div>

              <Dropdown
                v-if="!activeGroup.ready && store.activeLlmLoginMethods.length > 1"
                name="models__detail__login__dropdown"
                trigger="click"
                :disabled="store.llmSaving || store.llmLoading"
              >
                <Button name="models__detail__login__button" size="small" type="primary" :loading="store.llmSaving">
                  <template #icon><IconLogin2 :size="15" /></template>
                  Login
                </Button>
                <template #content>
                  <button
                    v-for="method in store.activeLlmLoginMethods"
                    :key="method.id"
                    name="models__detail__login__method"
                    type="button"
                    class="block h-8 w-[150px] px-3 text-left text-[12px] text-gray-700 hover:bg-[#f3f7ff] hover:text-[#165dff]"
                    @click="login(method.id)"
                  >
                    {{ method.label }}
                  </button>
                </template>
              </Dropdown>
              <Button
                v-else-if="!activeGroup.ready"
                name="models__detail__login__button"
                size="small"
                type="primary"
                :loading="store.llmSaving"
                :disabled="store.llmLoading"
                @click="login()"
              >
                <template #icon><IconLogin2 :size="15" /></template>
                Login
              </Button>
              <Button v-else name="models__detail__logout__button" size="small" :loading="store.llmSaving" :disabled="store.llmLoading" @click="logout">
                <template #icon><IconLogout :size="15" /></template>
                Logout
              </Button>
            </div>

            <div
              name="models__detail__settings"
              class="grid max-w-[620px] grid-cols-[120px_minmax(0,360px)] items-center gap-x-3 gap-y-3"
            >
              <div name="models__detail__model__label" class="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500">
                <IconCpu :size="14" stroke="1.8" />
                <span>Model</span>
              </div>
              <Select
                name="models__detail__model__select"
                :model-value="modelValue"
                size="small"
                :disabled="store.llmSaving || store.llmLoading"
                @change="(value) => store.setLlmModel(String(value))"
              >
                <Option v-for="model in activeGroup.models" :key="model.model" :value="model.model">
                  {{ model.label }}
                </Option>
              </Select>

              <div name="models__detail__effort__label" class="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500">
                <IconGauge :size="14" stroke="1.8" />
                <span>Effort</span>
              </div>
              <Select
                name="models__detail__effort__select"
                :model-value="effortValue"
                size="small"
                :disabled="store.llmSaving || store.llmLoading || effortDisabled"
                @change="(value) => store.setLlmEffort(toEffort(value))"
              >
                <Option v-for="effort in store.activeLlmEfforts" :key="effort.id" :value="effort.id">
                  {{ effort.label }}
                </Option>
              </Select>

              <div name="models__detail__compression__label" class="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500">
                <IconPercentage :size="14" stroke="1.8" />
                <span>Compression</span>
              </div>
              <div name="models__detail__compression__field" class="flex min-w-0 items-center gap-2">
                <input
                  name="models__detail__compression__input"
                  type="number"
                  min="1"
                  max="90"
                  step="1"
                  :value="compressionRemainingValue"
                  :disabled="store.llmSaving || store.llmLoading"
                  class="h-8 w-24 rounded-md border border-gray-300 bg-white px-2 text-[13px] font-semibold text-gray-800 outline-none transition focus:border-[#165dff] focus:ring-2 focus:ring-[#165dff]/15 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  @change="setCompressionRemaining"
                />
                <span class="shrink-0 text-[12px] font-semibold text-gray-500">% left</span>
                <span class="min-w-0 truncate text-[11px] text-gray-400">at {{ compressionTriggerUsed }}% used</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
