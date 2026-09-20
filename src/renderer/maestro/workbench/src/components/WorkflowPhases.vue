<template>
  <!--
    Phases, not a node graph. A dynamic workflow's shape is decided by ordinary control flow at run
    time — how many agents a fan-out opens depends on what the work turns out to be — so there is no
    static graph to draw. Drawing one anyway would mean inventing a picture the run need not follow,
    which is the failure the retired manifest graph had: authored by hand, never executed, wrong
    without any runtime symptom.
  -->
  <section name="workflow-phases" class="workflow-phases">
    <ol v-if="ordered.length" class="workflow-phases__list">
      <li v-for="phase in ordered" :key="phase.step" :name="`workflow-phases__item-${phase.step}`" class="workflow-phases__item">
        <span class="workflow-phases__step">{{ phase.step }}</span>
        <div class="workflow-phases__body">
          <strong>{{ phase.title }}</strong>
          <p v-if="phase.detail">{{ phase.detail }}</p>
        </div>
      </li>
    </ol>
    <p v-else class="workflow-phases__empty">{{ text.noPhases }}</p>
    <p class="workflow-phases__note">{{ text.phasesNote }}</p>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { DynamicPhase } from '@shared/workflowLibrary.type'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
const props = defineProps<{ phases: DynamicPhase[] }>()
const text = computed(() => i18nHelper.workflowLibrary)
const ordered = computed(() => props.phases.map((phase, index) => ({ ...phase, step: index + 1 })))
</script>
<style lang="less">@import './WorkflowPhases.less';</style>
