<template>
  <div v-if="total > pageSize" name="trench__sniping__page-buttons" class="sniping-page-buttons">
    <a-button name="trench__sniping__previous-page" size="mini" :disabled="disabled || page <= 1" @click="emit('change', page - 1)">
      {{ t('trench.sniping.previous') }}
    </a-button>
    <span>{{ page }} / {{ Math.ceil(total / pageSize) }}</span>
    <a-button name="trench__sniping__next-page" size="mini" :disabled="disabled || page * pageSize >= total" @click="emit('change', page + 1)">
      {{ t('trench.sniping.next') }}
    </a-button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

withDefaults(defineProps<{ page: number; total: number; pageSize: number; disabled?: boolean }>(), {
  disabled: false,
});
const emit = defineEmits<{ change: [page: number] }>();
const { t } = useI18n();
</script>
