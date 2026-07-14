<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract, PackageInfo } from '@cowork-shared/coach.api'
import appLogo from '@cowork-renderer/common/assets/icons/app-logo.png'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const info = ref<PackageInfo | null>(null)

onMounted(async () => {
  info.value = await coach.getPackageInfo()
})
</script>

<template>
  <section class="flex h-full min-h-0 items-center justify-center bg-white">
    <div class="flex flex-col items-center gap-3 text-center">
      <img :src="appLogo" alt="" class="h-16 w-16 rounded-2xl shadow-sm" />
      <div class="text-[16px] font-semibold text-gray-800">{{ info?.productName || 'Micromeet Cowork' }}</div>
      <div class="space-y-1 text-[12px] leading-relaxed text-gray-500">
        <div>Version <span class="font-medium text-gray-700">{{ info?.version ?? '-' }}</span></div>
        <div>Build <span class="font-medium text-gray-700">{{ info?.versionCode ?? '-' }}</span></div>
      </div>
    </div>
  </section>
</template>
