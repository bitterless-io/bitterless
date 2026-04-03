
<script setup lang="ts">
import { computed } from 'vue';
import chatIcon from '@renderer/common/assets/icons/menu-icons/chat.png';
import todoIcon from '@renderer/common/assets/icons/menu-icons/todo.png';
import miniAppIcon from '@renderer/common/assets/icons/menu-icons/mini-app.png';
import connectorIcon from '@renderer/common/assets/icons/menu-icons/connector.png';
import settingIcon from '@renderer/common/assets/icons/menu-icons/setting.png';
import debugIcon from '@renderer/common/assets/icons/menu-icons/debug.png';
import pluginIcon from '@renderer/common/assets/icons/menu-icons/plugin.png';
import chatIconActive from '@renderer/common/assets/icons/menu-icons/chat_active.png';
import todoIconActive from '@renderer/common/assets/icons/menu-icons/todo_active.png';
import miniAppIconActive from '@renderer/common/assets/icons/menu-icons/mini-app_active.png';
import connectorIconActive from '@renderer/common/assets/icons/menu-icons/connector_active.png';
import settingIconActive from '@renderer/common/assets/icons/menu-icons/setting_active.png';
import debugIconActive from '@renderer/common/assets/icons/menu-icons/debug_active.png';
import pluginIconActive from '@renderer/common/assets/icons/menu-icons/plugin_active.png';

const iconMap: Record<string, string> = {
  'chat.png': chatIcon,
  'todo.png': todoIcon,
  'mini-app.png': miniAppIcon,
  'connector.png': connectorIcon,
  'setting.png': settingIcon,
  'debug.png': debugIcon,
  'plugin.png': pluginIcon,
};

const activeIconMap: Record<string, string> = {
  'chat.png': chatIconActive,
  'todo.png': todoIconActive,
  'mini-app.png': miniAppIconActive,
  'connector.png': connectorIconActive,
  'setting.png': settingIconActive,
  'debug.png': debugIconActive,
  'plugin.png': pluginIconActive,
};

const props = defineProps<{
  icon: string;
  active?: boolean;
}>();

const iconSrc = computed(() => {
  if (props.active) {
    return activeIconMap[props.icon] || iconMap[props.icon] || '';
  }
  return iconMap[props.icon] || '';
});
</script>

<template>
  <div class="home-menu-item" :class="{ 'home-menu-item--active': active }">
    <img :src="iconSrc" class="home-menu-item__icon" alt="" />
  </div>
</template>

<style lang="less">
@import './HomeMenuItem.less';
</style>
