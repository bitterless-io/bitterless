<script setup lang="ts">
import { watch } from 'vue'
import type { ShortcutStore } from './store/shortcut.store'
import './SlashMenu.less'

const props = defineProps<{ store: ShortcutStore }>()
defineEmits<{ commit: []; select: [index: number] }>()

// The list scrolls now (420px cap in the Less), so the arrow keys must drag the viewport with them —
// otherwise selection walks off-screen and the panel looks frozen on the same few rows.
// `block: 'nearest'` rather than centring: centring makes the list jump on every keypress.
watch(
  () => props.store.activeIndex,
  (index) => {
    requestAnimationFrame(() => document.getElementById(`maestro-slash-${index}`)?.scrollIntoView({ block: 'nearest' }))
  }
)
</script>

<template>
  <div v-if="store.open && store.matches.length" id="maestro-slash-menu" name="maestroSlash__menu" class="maestro-slash" role="listbox">
    <button
      v-for="(item, index) in store.matches"
      :id="`maestro-slash-${index}`"
      :key="item.name"
      name="maestroSlash__item"
      class="maestro-slash__item"
      :class="{ 'maestro-slash__item--active': index === store.activeIndex }"
      type="button"
      role="option"
      tabindex="-1"
      :aria-selected="index === store.activeIndex"
      :disabled="store.pending"
      @mousedown.prevent="$emit('select', index)"
      @click="$emit('commit')"
    >
      <span class="maestro-slash__name">{{ item.name }}</span>
      <span class="maestro-slash__hint">{{ item.hint }}</span>
    </button>
  </div>
</template>
