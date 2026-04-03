<template>
  <div class="example-container">
    <h3>BLDropdownList Example</h3>
    
    <BLDropdownList trigger="click" :popup-max-height="200">
      <a-button>Open Dropdown</a-button>
      <template #content>
        <BLDropdownListItem item-key="1" @click="handleSelect">
          Option 1
        </BLDropdownListItem>
        <BLDropdownListItem item-key="2" @click="handleSelect">
          Option 2
        </BLDropdownListItem>
        <BLDropdownListItem item-key="3" disabled @click="handleSelect">
          Option 3 (Disabled)
        </BLDropdownListItem>
        <BLDropdownListItem item-key="4" height="60px" @click="handleSelect">
          Option 4 (Custom Height)
        </BLDropdownListItem>
      </template>
    </BLDropdownList>

    <p v-if="selected">Selected: {{ selected }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { BLDropdownList, BLDropdownListItem } from './index';

const selected = ref<string | number | null>(null);

const handleSelect = (key: string | number | null) => {
  selected.value = key;
  console.log('Selected:', key);
};
</script>

<style lang="less" scoped>
.example-container {
  padding: 20px;
}
</style>
