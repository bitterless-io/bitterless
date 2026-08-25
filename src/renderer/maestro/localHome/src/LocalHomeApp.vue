<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import Chat from '@/views/chat/Chat.vue'
import MessageSearch from '@/views/chat/components/MessageSearch/MessageSearch.vue'
import {
  destroySearchShortcut,
  initSearchShortcut
} from '@/views/chat/components/MessageSearch/messageSearch.store'

onMounted(initSearchShortcut)
onUnmounted(destroySearchShortcut)
</script>

<template>
  <main name="maestro-local-home" class="maestro-local-home">
    <Chat />
    <MessageSearch />
  </main>
</template>
