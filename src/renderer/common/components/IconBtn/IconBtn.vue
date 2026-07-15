<script setup lang="ts">
import { Button } from '@arco-design/web-vue'
import './IconBtn.less'

defineOptions({ inheritAttrs: false })
</script>

<template>
  <Button
    v-bind="$attrs"
    class="icon-btn"
    type="text"
    html-type="button"
  >
    <template #icon>
      <slot />
    </template>
  </Button>
</template>
