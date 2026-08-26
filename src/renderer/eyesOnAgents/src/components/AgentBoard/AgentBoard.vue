<template>
  <div name="eyesOnAgents__board" class="agent-board">
    <DomainColumn
      name="eyesOnAgents__focusColumn"
      :threads="eyesOnAgentsStore.focusThreads"
    />
  </div>
</template>

<script setup lang="ts">
import DomainColumn from '../DomainColumn/DomainColumn.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';
</script>

<style lang="less">
@import './AgentBoard.less';
</style>
