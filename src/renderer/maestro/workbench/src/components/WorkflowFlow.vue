<template>
  <section name="workflow-flow" class="workflow-flow">
    <div ref="viewport" name="workflow-flow__viewport" class="workflow-flow__viewport">
      <svg v-if="layout.nodes.length" :width="layout.width * zoom" :height="layout.height * zoom" :viewBox="`0 0 ${layout.width} ${layout.height}`" class="workflow-flow__diagram" :aria-label="text.flow">
        <defs><marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" stroke-width="1.5" /></marker></defs>
        <g v-for="edge in layout.edges" :key="edge.key" class="workflow-flow__edge">
          <path :d="edge.path" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#workflow-arrow)" />
          <text v-if="edge.label" :x="edge.labelX" :y="edge.labelY" text-anchor="middle">{{ edge.label }}</text>
        </g>
        <foreignObject v-for="node in layout.nodes" :key="node.id" :x="node.x" :y="node.y" :width="node.width" :height="node.height + 8">
          <button :name="`workflow-flow__node-${node.id}`" type="button" class="workflow-flow__node" :class="[`workflow-flow__node--${node.kind}`, { 'workflow-flow__node--selected': selected === node.id }]" :aria-pressed="selected === node.id" :title="node.label" @click="$emit('select', node.id)">
            <span class="workflow-flow__icon"><component :is="icons[node.kind]" :size="19" stroke="1.7" /></span>
            <span class="workflow-flow__caption"><strong>{{ node.label }}</strong><span>{{ text.kinds[node.kind] }}</span></span>
          </button>
        </foreignObject>
      </svg>
      <div v-else class="workflow-flow__empty">{{ text.emptyGraph }}</div>
    </div>
    <div name="workflow-flow__controls" class="workflow-flow__controls">
      <button type="button" :aria-label="text.zoomOut" :disabled="zoom <= .4" @click="zoom = Math.max(.4, zoom - .15)"><IconMinus :size="16" /></button>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <button type="button" :aria-label="text.zoomIn" :disabled="zoom >= 1.8" @click="zoom = Math.min(1.8, zoom + .15)"><IconPlus :size="16" /></button>
      <button type="button" class="workflow-flow__fit" @click="fit()"><IconMaximize :size="15" />{{ text.fit }}</button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { IconCode, IconRobot, IconGitBranch, IconRepeat, IconStack2, IconSitemap, IconListCheck, IconMinus, IconPlus, IconMaximize } from '@tabler/icons-vue'
import type { WorkflowManifest } from '@shared/workflowLibrary.type'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { layoutWorkflowGraph } from '../workflowGraph'
const props = defineProps<{ graph: WorkflowManifest['graph']; selected: string }>()
defineEmits<{ select: [id: string] }>()
const text = computed(() => i18nHelper.workflowLibrary)
const viewport = ref<HTMLElement>()
const zoom = ref(1)
const layout = computed(() => layoutWorkflowGraph(props.graph))
const icons = { function: IconCode, agent: IconRobot, parallel: IconStack2, branch: IconGitBranch, foreach: IconListCheck, loop: IconRepeat, workflow: IconSitemap }
const fit = (): void => { zoom.value = Math.max(.4, Math.min(1, ((viewport.value?.clientWidth || 840) - 20) / layout.value.width)); viewport.value?.scrollTo({ left: 0, top: 0 }) }
watch(() => props.graph, async () => { await nextTick(); fit() })
onMounted(fit)
</script>
<style lang="less">@import './WorkflowFlow.less';</style>
