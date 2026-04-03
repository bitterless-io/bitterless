<template>
  <div class="bl-full-container todo-placeholder">
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { todoWindowEmitter } from '@/emitter/todoWindow.emitter';

onMounted(() => {
  todoWindowEmitter.showTodoView();
});

onUnmounted(() => {
  todoWindowEmitter.hideTodoView();
});
</script>

<style lang="less">
@import './Todo.less';
</style>
