<template>
  <div class="add-domain-button" @click="handleAdd">
    <icon-plus :size="14" />
  </div>
</template>

<script setup lang="ts">
import { IconPlus } from '@arco-design/web-vue/es/icon';
import { todoStore } from '../../store/todo.store';

const handleAdd = () => {
  todoStore.createDomain();
};
</script>

<style lang="less">
@import './AddDomainButton.less';
</style>
