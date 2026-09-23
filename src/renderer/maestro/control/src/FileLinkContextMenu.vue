<template>
  <Teleport to="body">
    <div v-if="menu" name="file-link-menu__overlay" class="file-link-menu__overlay" @click="close" @contextmenu.prevent="close">
      <div ref="panel" name="fileLinkMenu" class="file-link-menu" :style="position" role="menu" @click.stop>
        <!-- 路径只读不点:菜单里能看见复制的到底是哪一条,省掉"复制完才发现点错了链接"。 -->
        <p name="fileLinkMenu__path" class="file-link-menu__path" :title="menu.path">{{ menu.path }}</p>
        <button type="button" name="fileLinkMenu__copy" class="file-link-menu__item" role="menuitem" @click="fileLinkMenuStore.copyPath()">{{ text.copyPath }}</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { fileLinkMenuStore } from './store/fileLinkMenu.store';
import './FileLinkContextMenu.less';

const text = computed(() => i18nHelper.maestroControl.chat);
const menu = computed(() => fileLinkMenuStore.menu);
const panel = ref<HTMLElement | null>(null);
const position = ref({ left: '0px', top: '0px' });
let returnFocus: HTMLElement | null = null;
const close = (): void => fileLinkMenuStore.close();
const buttons = (): HTMLButtonElement[] => [...(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];

const onKeydown = (event: KeyboardEvent): void => {
  if (!menu.value) return;
  event.stopImmediatePropagation();
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const items = buttons(), current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (items.length) items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (buttons().includes(document.activeElement as HTMLButtonElement)) (document.activeElement as HTMLButtonElement).click();
  }
};

watch(menu, async (value, previous) => {
  if (!value) { returnFocus?.focus({ preventScroll: true }); return; }
  if (!previous) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  if (menu.value !== value || !panel.value) return;
  position.value = {
    left: `${Math.max(4, Math.min(value.x, window.innerWidth - panel.value.offsetWidth - 4))}px`,
    top: `${Math.max(4, Math.min(value.y, window.innerHeight - panel.value.offsetHeight - 4))}px`
  };
  buttons()[0]?.focus({ preventScroll: true });
});
onMounted(() => window.addEventListener('keydown', onKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));
</script>
