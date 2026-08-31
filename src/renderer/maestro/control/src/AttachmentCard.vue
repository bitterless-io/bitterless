<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IconFolder } from '@tabler/icons-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
import './AttachmentCard.less'

const props = defineProps<{
  name: string
  path?: string
  isDirectory?: boolean
  missing?: boolean
}>()

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const thumbnail = ref('')

const extension = computed(() => {
  const basename = (props.name || props.path || '').split(/[\\/]/).pop() || ''
  const dot = basename.lastIndexOf('.')
  return dot > 0 ? basename.slice(dot + 1).toLowerCase() : ''
})

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'ico',
  'tif',
  'tiff'
])

// Main decides directory-ness. A folder named `photos.png` must never enter the image lane.
const isImage = computed(
  () => !props.isDirectory && IMAGE_EXTENSIONS.has(extension.value)
)

watch(
  () => [props.path, isImage.value] as const,
  async ([path, image]) => {
    thumbnail.value = ''
    if (!path || !image) return
    const result = await coach.fileThumbnail({ path }).catch(() => null)
    if (result?.ok && result.dataUrl) thumbnail.value = result.dataUrl
  },
  { immediate: true }
)
</script>

<template>
  <div
    name="attachmentCard"
    class="attachment-card"
    :class="{ 'attachment-card--missing': props.missing }"
  >
    <div name="attachmentCard__art" class="attachment-card__art">
      <IconFolder
        v-if="props.isDirectory"
        class="attachment-card__folder"
        :size="24"
        stroke="1.6"
      />
      <img
        v-else-if="thumbnail"
        class="attachment-card__thumbnail"
        :src="thumbnail"
        :alt="props.name"
      />
      <span v-else class="attachment-card__extension">{{ extension || 'file' }}</span>
    </div>

    <div name="attachmentCard__text" class="attachment-card__text">
      <span class="attachment-card__name" :title="props.name">{{ props.name }}</span>
      <span
        v-if="props.missing"
        class="attachment-card__missing"
        :title="props.path || ''"
      >missing</span>
      <span v-else class="attachment-card__path" :title="props.path || ''">
        {{ props.path || '' }}
      </span>
    </div>
  </div>
</template>
