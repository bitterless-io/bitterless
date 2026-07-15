<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract, PackageInfo } from '@maestro-shared/coach.api'
import appLogo from '@maestro-renderer/common/assets/icons/app-logo.png'
import './WorkbenchAboutView.less'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const info = ref<PackageInfo | null>(null)

onMounted(async () => {
  info.value = await coach.getPackageInfo()
})
</script>

<template>
  <section class="workbench-about">
    <div class="workbench-about__content">
      <img :src="appLogo" alt="" class="workbench-about__logo" />
      <div class="workbench-about__product">{{ info?.productName || 'Bitterless Maestro' }}</div>
      <div class="workbench-about__metadata">
        <div>Version <span class="workbench-about__metadata__value">{{ info?.version ?? '-' }}</span></div>
        <div>Build <span class="workbench-about__metadata__value">{{ info?.versionCode ?? '-' }}</span></div>
      </div>
    </div>
  </section>
</template>
