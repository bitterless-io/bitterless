<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue';
import { Button, Spin } from '@arco-design/web-vue';
import { IconX } from '@tabler/icons-vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { localHomeAuthStore } from '@renderer/maestro/localHome/src/localHomeAuth.store';
import Login from '@renderer/home/src/views/login/Login.vue';
import { ControlSubscriptionScope } from './controlSubscriptions.service';
import './ControlApp.less';
import './ControlAuthApp.less';

const ControlApp = defineAsyncComponent(() => import('./ControlApp.vue'));
const authorityIdentity = computed(
  () => `${localHomeAuthStore.snapshot?.authorityEpoch}:${localHomeAuthStore.snapshot?.email}`
);
const protectedGeneration = ref(0);
watch(
  () =>
    [localHomeAuthStore.ready && !localHomeAuthStore.loggingOut, authorityIdentity.value] as const,
  ([ready, identity], [, previousIdentity]) => {
    if (!ready || identity !== previousIdentity) protectedGeneration.value += 1;
  },
  { flush: 'sync' }
);
const loginRoot = ref<HTMLElement | null>(null);
const subscriptions = new ControlSubscriptionScope();
const resizing = ref(false);
const loginVisible = computed(() => !localHomeAuthStore.ready || localHomeAuthStore.loggingOut);
const panelFocused = ref(false);
const onPanelFocus = (): void => {
  panelFocused.value = true;
};
const onPanelBlur = (): void => {
  panelFocused.value = false;
};
const syncLoginFocus = (visible: boolean): void => {
  if (visible) {
    panelFocused.value = document.hasFocus();
    window.addEventListener('focus', onPanelFocus);
    window.addEventListener('blur', onPanelBlur);
  } else {
    window.removeEventListener('focus', onPanelFocus);
    window.removeEventListener('blur', onPanelBlur);
    panelFocused.value = false;
  }
};
watch(loginVisible, syncLoginFocus, { flush: 'post' });
let pointerId: number | null = null;
let startX = 0;
let startWidth = 0;

const endResize = (event?: PointerEvent): void => {
  if (!resizing.value || (event && event.pointerId !== pointerId)) return;
  resizing.value = false;
  pointerId = null;
  xpcRenderer.broadcast('coach/sidebar-width', { resizing: false, ts: Date.now() });
};
const beginResize = (event: PointerEvent): void => {
  if (event.button !== 0 || resizing.value) return;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  pointerId = event.pointerId;
  startX = event.screenX;
  startWidth = window.innerWidth;
  resizing.value = true;
  event.preventDefault();
  xpcRenderer.broadcast('coach/sidebar-width', { resizing: true, ts: Date.now() });
};
const moveResize = (event: PointerEvent): void => {
  if (!resizing.value || event.pointerId !== pointerId) return;
  xpcRenderer.broadcast('coach/sidebar-width', {
    width: startWidth + startX - event.screenX,
    resizing: true,
    ts: Date.now()
  });
};
const closePanel = (): void => {
  endResize();
  xpcRenderer.broadcast('coach/sidebar-close', { ts: Date.now() });
};
const focusLogin = (): void => {
  void nextTick(() => {
    const root = loginRoot.value;
    (
      root?.querySelector<HTMLElement>('input') || root?.querySelector<HTMLElement>('button')
    )?.focus();
  });
};
watch(() => localHomeAuthStore.authResolved, focusLogin);
onMounted(() => {
  syncLoginFocus(loginVisible.value);
  subscriptions.subscribe('coach/login-request', focusLogin);
  focusLogin();
});
onBeforeUnmount(() => {
  syncLoginFocus(false);
  subscriptions.dispose();
  endResize();
});
</script>

<template>
  <ControlApp
    v-if="localHomeAuthStore.ready && !localHomeAuthStore.loggingOut"
    :key="protectedGeneration"
  />
  <section v-else ref="loginRoot" name="control-auth" class="control-app control-auth">
    <div
      name="control-auth__resize-handle"
      class="control-app__resize-handle"
      :class="{ 'control-app__resize-handle--resizing': resizing }"
      :title="i18nHelper.menuBar.maestro.resizePanel"
      :aria-label="i18nHelper.menuBar.maestro.resizePanel"
      @pointerdown="beginResize"
      @pointermove="moveResize"
      @pointerup="endResize"
      @pointercancel="endResize"
      @lostpointercapture="endResize"
    ></div>
    <div
      name="control-auth__card"
      class="control-app__card"
      :class="{ 'control-app__card--focused': panelFocused }"
    >
      <header name="control-auth__toolbar" class="control-app__toolbar">
        <span class="control-app__session-placeholder">Bitterless</span>
        <button
          name="control-auth__close"
          type="button"
          class="control-app__close"
          :title="i18nHelper.menuBar.maestro.hidePanel"
          :aria-label="i18nHelper.menuBar.maestro.hidePanel"
          @click="closePanel"
        >
          <IconX :size="14" stroke="2" />
        </button>
      </header>
      <div
        v-if="!localHomeAuthStore.authResolved || localHomeAuthStore.loggingOut"
        name="control-auth__status"
        class="control-auth__status"
        role="status"
      >
        <template v-if="localHomeAuthStore.authorityUnavailable">
          <p>{{ i18nHelper.auth.homeAuthorityUnavailable }}</p>
          <Button type="primary" @click="localHomeAuthStore.refreshAuthSnapshot()">{{
            i18nHelper.auth.homeAuthorityRetry
          }}</Button>
        </template>
        <template v-else>
          <Spin />
          <p>{{ i18nHelper.auth.homeAuthorityLoading }}</p>
        </template>
      </div>
      <Login v-else :auth="localHomeAuthStore" compact />
    </div>
  </section>
</template>
