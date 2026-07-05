<template>
  <div class="add-domain-button" @click="handleAdd">
    <IconPlus :size="14" />
  </div>
</template>

<script setup lang="ts">
import { IconPlus } from '@tabler/icons-vue';
import { todoStore } from '../../store/todo.store';

const handleAdd = () => {
  todoStore.createDomain();
};
</script>

<style lang="less">
@import './AddDomainButton.less';
</style>
