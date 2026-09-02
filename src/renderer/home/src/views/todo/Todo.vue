<template>
  <div class="bl-full-container todo-placeholder">
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoWindowEmitter } from '@/emitter/todoWindow.emitter';
import { authStore } from '@/stores/auth/auth.store';

let mounted = false;

onMounted(async () => {
  mounted = true;
  try {
    await authStore.ensureTodoistSyncReady();
    if (!mounted) return;
    await todoWindowEmitter.showTodoView();
    if (!mounted) await todoWindowEmitter.hideTodoView();
  } catch (error) {
    console.error('[Todo] Todo runtime is unavailable:', error);
    // No authenticated customer is the normal state of an install that has never signed in, so it
    // must not be reported as a local data runtime failure.
    if (mounted) {
      Message.error(
        authStore.current ? i18nHelper.todo.runtimeUnavailable : i18nHelper.todo.sessionRequired,
      );
    }
  }
});

onUnmounted(() => {
  mounted = false;
  void todoWindowEmitter.hideTodoView().catch((error) => {
    console.error('[Todo] Failed to hide Todo view:', error);
  });
});
</script>

<style lang="less">
@import './Todo.less';
</style>
