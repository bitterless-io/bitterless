<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Button, Dropdown, Empty, Option, Select } from '@arco-design/web-vue'
import { IconCircleCheckFilled, IconCircleDashed, IconCpu, IconGauge, IconLogin2, IconLogout, IconPercentage, IconSettings } from '@tabler/icons-vue'
import type { LlmEffort, LlmLoginMethod } from '@maestro-shared/coach.api'
import { workbenchStore as store } from '../workbench.store'
import { useRouter } from 'vue-router'
import './WorkbenchModelsView.less'

const router = useRouter()
const activeGroup = computed(() => store.activeLlmGroup)
const activeIsLocal = computed(() => activeGroup.value?.provider === 'local')
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
  if (activeIsLocal.value) return activeGroup.value?.ready ? `${label} ready` : `${label} needs an account`
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

const configureLocal = (): void => {
  void router.push({ name: 'sub2api' })
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
  <section name="models" class="workbench-models">
    <div name="models__active" class="workbench-models__active">
      <div name="models__active__card" class="workbench-models__active__card">
        <div name="models__active__title" class="workbench-models__active__title">Active Model</div>
        <div name="models__active__fields" class="workbench-models__active__fields">
          <div name="models__active__provider" class="workbench-models__active__field workbench-models__active__field--provider">
            <div name="models__active__provider__label" class="workbench-models__active__label">Provider</div>
            <div name="models__active__provider__value" class="workbench-models__active__value">
              {{ activeProviderLabel }}
            </div>
          </div>
          <div name="models__active__model" class="workbench-models__active__field workbench-models__active__field--model">
            <div name="models__active__model__label" class="workbench-models__active__label">Model</div>
            <div name="models__active__model__value" class="workbench-models__active__value">
              {{ activeModelLabel }}
            </div>
          </div>
          <div name="models__active__effort" class="workbench-models__active__field workbench-models__active__field--effort">
            <div name="models__active__effort__label" class="workbench-models__active__label">Effort</div>
            <div name="models__active__effort__value" class="workbench-models__active__value">
              {{ activeEffortLabel }}
            </div>
          </div>
          <div name="models__active__compression" class="workbench-models__active__field workbench-models__active__field--compression">
            <div name="models__active__compression__label" class="workbench-models__active__label">Compression</div>
            <div class="workbench-models__active__value">{{ compressionRemainingValue }}% left</div>
          </div>
        </div>
      </div>
    </div>

    <div name="models__body" class="workbench-models__body">
      <div name="models__providers" class="workbench-models__providers">
        <div name="models__providers__title" class="workbench-models__providers__title">
          Providers
        </div>
        <button
          v-for="group in store.llmProviderGroups"
          :key="group.provider"
          name="models__providers__row"
          type="button"
          class="workbench-models__providers__row"
          :class="{ 'workbench-models__providers__row--active': group.active }"
          :disabled="store.llmSaving || store.llmLoading"
          @click="store.setLlmProvider(group.provider)"
        >
          <span class="workbench-models__providers__identity">
            <span class="workbench-models__providers__name">{{ group.label }}</span>
            <span
              class="workbench-models__providers__status"
              :class="{ 'workbench-models__providers__status--ready': group.ready }"
              :title="group.ready ? 'Signed in' : 'Not signed in'"
            />
          </span>
        </button>
        <Empty v-if="!store.llmProviderGroups.length" class="workbench-models__empty" description="No providers" />
      </div>

      <div name="models__detail" class="workbench-models__detail">
        <Empty v-if="store.llmLoading" class="workbench-models__detail__empty" description="Loading models" />
        <Empty v-else-if="!store.llmConfig || !activeGroup || !activeModel" class="workbench-models__detail__empty" description="No models" />
        <template v-else>
          <div name="models__detail__content" class="workbench-models__detail__content">
            <div name="models__detail__auth" class="workbench-models__auth">
              <div name="models__detail__auth__body" class="workbench-models__auth__body">
                <div name="models__detail__auth__title" class="workbench-models__auth__title">
                  <IconCircleCheckFilled
                    v-if="activeGroup.ready"
                    :size="17"
                    class="workbench-models__auth__icon workbench-models__auth__icon--ready"
                    title="登录成功"
                  />
                  <IconCircleDashed
                    v-else
                    :size="17"
                    stroke="1.8"
                    class="workbench-models__auth__icon"
                    title="未登录"
                  />
                  <span class="workbench-models__auth__label">{{ authStatusLabel }}</span>
                </div>
              </div>

              <Button
                v-if="activeIsLocal"
                name="models__detail__configure__button"
                size="small"
                type="primary"
                :disabled="store.llmLoading"
                @click="configureLocal"
              >
                <template #icon><IconSettings :size="15" /></template>
                Configure
              </Button>
              <Dropdown
                v-else-if="!activeGroup.ready && store.activeLlmLoginMethods.length > 1"
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
                    class="workbench-models__login-method"
                    @click="login(method.id)"
                  >
                    {{ method.label }}
                  </button>
                </template>
              </Dropdown>
              <Button
                v-else-if="!activeGroup.ready && store.activeLlmLoginMethods.length"
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
              <Button v-else-if="activeGroup.ready" name="models__detail__logout__button" size="small" :loading="store.llmSaving" :disabled="store.llmLoading" @click="logout">
                <template #icon><IconLogout :size="15" /></template>
                Logout
              </Button>
            </div>

            <div
              name="models__detail__settings"
              class="workbench-models__settings"
            >
              <div name="models__detail__model__label" class="workbench-models__settings__label">
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

              <div name="models__detail__effort__label" class="workbench-models__settings__label">
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

              <div name="models__detail__compression__label" class="workbench-models__settings__label">
                <IconPercentage :size="14" stroke="1.8" />
                <span>Compression</span>
              </div>
              <div name="models__detail__compression__field" class="workbench-models__compression">
                <input
                  name="models__detail__compression__input"
                  type="number"
                  min="1"
                  max="90"
                  step="1"
                  :value="compressionRemainingValue"
                  :disabled="store.llmSaving || store.llmLoading"
                  class="workbench-models__compression__input"
                  @change="setCompressionRemaining"
                />
                <span class="workbench-models__compression__unit">% left</span>
                <span class="workbench-models__compression__hint">at {{ compressionTriggerUsed }}% used</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
