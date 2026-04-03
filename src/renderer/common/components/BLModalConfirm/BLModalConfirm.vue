<template>
  <a-modal
    :visible="visible"
    :mask-closable="false"
    :esc-to-close="true"
    :closable="false"
    :footer="false"
    @cancel="onCancel"
  >
    <div class="bl-modal-confirm">
      <div class="bl-modal-confirm__title">{{ title }}</div>
      <div class="bl-modal-confirm__content">{{ content }}</div>
      <div class="bl-modal-confirm__footer">
        <a-button v-if="cancelTitle" type="secondary" size="small" @click="onCancel">
          {{ cancelTitle }}
        </a-button>
        <a-button v-if="okTitle" type="primary" size="small" @click="onOk">
          {{ okTitle }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
interface Props {
  visible: boolean;
  title: string;
  content: string;
  okTitle?: string;
  cancelTitle?: string;
}

withDefaults(defineProps<Props>(), {
  okTitle: '',
  cancelTitle: '',
});

const emit = defineEmits<{
  ok: [];
  cancel: [];
}>();

const onOk = () => {
  emit('ok');
};

const onCancel = () => {
  emit('cancel');
};
</script>

<style lang="less">
@import './BLModalConfirm.less';
</style>
