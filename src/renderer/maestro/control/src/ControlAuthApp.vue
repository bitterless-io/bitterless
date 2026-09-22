<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Component
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

/**
 * 受保护的那棵树只在账号验过之后才求值 —— 代价是这次 `import()` 发生在挂载很久之后,而那正是
 * dev 下最容易失败的一刻。Cowork 侧 2026-09-22 连报两次
 * `TypeError: Failed to fetch dynamically imported module: …/control/src/ControlApp.vue`;
 * 日志里紧挨着报错的前两行是 `vite connecting... / connected.` —— 开发服务器刚重启过一轮
 * (改 main/preload/配置都会让 electron-vite 重起 renderer server),页面自己还活着,于是这次
 * `import()` 打在一个刚换过模块图、正在重跑 dep 预优化的服务器上,直接被拒。
 *
 * **真正的缺陷是没有恢复路径**:裸 `defineAsyncComponent(loader)` 会把这次拒绝缓存下来,
 * 没有 `errorComponent` 就渲染成空,门闸也不会再翻一次 —— 面板从此一直是白的,只能重启 app。
 * 所以补三样:有界重试、失败可见、可手动再来一次。本仓同构(paired with micromeet-cowork),
 * 本仓尚未报过同一现象,但代码形状与那边逐字一致,所以同一个洞在这里是成立的。
 *
 * 刻意**没有**加 `timeout`:报的是 reject 不是 hang,给大图的首次 dev 编译设超时会把"慢"误判成
 * "坏",重试还会成倍放大编译量。
 */
const RETRY_LIMIT = 2;

/**
 * 重试用尽后的兜底面。**文案硬编码英文、不走 i18n** —— 这条路要在"某个模块取不回来"时仍然能
 * 显示,而 Cowork 侧的同一个兜底面连 i18n 自己都可能取不回来;两仓保持同一份文案。
 *
 * 重来一次只能靠整页 reload:Vue 把 async 组件的失败状态缓存在包装组件上,重新挂载同一个包装
 * 不会再调 loader。
 */
const ControlAppFailed: Component = {
  name: 'ControlAppFailed',
  setup:
    () =>
    () =>
      h(
        'div',
        {
          name: 'control-auth__load-failure',
          style:
            'padding:16px;font:12px/1.6 ui-monospace,monospace;color:#b42318;white-space:pre-wrap;word-break:break-word'
        },
        [
          'The control panel could not be loaded.\n\n',
          h(
            'a',
            {
              href: '#',
              name: 'control-auth__load-failure__reload',
              style: 'color:#1d4ed8',
              onClick: (event: Event) => {
                event.preventDefault();
                window.location.reload();
              }
            },
            'Reload the panel'
          ),
          '\n\nSee the Workbench ▸ Log tab for the trace.'
        ]
      )
};

const ControlApp = defineAsyncComponent({
  loader: () => import('./ControlApp.vue'),
  errorComponent: ControlAppFailed,
  onError: (error, retry, fail, attempts) => {
    if (attempts <= RETRY_LIMIT) {
      // 退避一小段再来:服务器重启 / dep 重优化那个窗口通常是几百毫秒量级。
      window.setTimeout(retry, attempts * 300);
      return;
    }
    // 自己打一条 —— 给了 errorComponent 之后 Vue 是渲染它而不是继续往上抛,但这条失败必须进日志。
    console.error(
      `[control-auth] ControlApp failed to load after ${attempts} attempts — the panel is showing its fallback`,
      error instanceof Error ? error.stack || error.message : String(error)
    );
    fail();
  }
});
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
