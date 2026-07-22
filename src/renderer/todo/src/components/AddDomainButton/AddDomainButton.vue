<template>
  <div class="add-domain-button" @click="handleAdd">
    <IconPlus :size="14" />
  </div>
</template>

<script setup lang="ts">
import { IconPlus } from '@tabler/icons-vue';
import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoStore } from '../../store/todo.store';

const handleAdd = async (): Promise<void> => {
  try {
    await todoStore.createDomain();
  } catch (error) {
    console.error('[todo] Domain create failed:', error);
    Message.error(i18nHelper.todo.runtimeUnavailable);
  }
};
</script>

<style lang="less">
@import './AddDomainButton.less';
</style>
