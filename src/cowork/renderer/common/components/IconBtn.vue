<script setup lang="ts">
// Reusable icon button for the coach chrome: a 32px borderless, transparent square that centers a
// single icon and grows a soft translucent background on hover, with a subtle scale-down on press —
// the same treatment as the home header's nav / Settings buttons (navBtn). Pass the icon as the
// default slot; `title`, `disabled`, `@click`, etc. fall through to the root <button>. `no-drag`
// keeps it clickable inside the frameless window's `-webkit-app-region: drag` regions (a no-op
// elsewhere).
</script>

<template>
  <button
    type="button"
    class="no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[18px] text-gray-600 transition hover:bg-black/10 hover:text-gray-800 active:scale-95 active:bg-black/15 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
  >
    <slot />
  </button>
</template>
