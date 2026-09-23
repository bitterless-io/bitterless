<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { Message } from '@arco-design/web-vue';
import { IconUser } from '@tabler/icons-vue';
import { localHomeAuthStore as auth } from '@renderer/maestro/localHome/src/localHomeAuth.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { accountMenuStore } from '../../store/accountMenu.store';
import './UserAvatar.less';

const signedIn = computed(() => auth.ready && !auth.loggingOut);
const email = computed(() => signedIn.value ? auth.snapshot?.email || '' : '');
onMounted(() => auth.initialize());
onBeforeUnmount(() => auth.dispose());
const openAccount = async (event: MouseEvent): Promise<void> => {
  const { x, y, height } = (event.currentTarget as HTMLElement).getBoundingClientRect();
  await accountMenuStore.show({ x, y: y + height, email: email.value, signedIn: signedIn.value });
  if (accountMenuStore.error) Message.error(i18nHelper.setting.account[accountMenuStore.error]);
};
</script>
<template>
  <button name="menubar__account" type="button" class="maestro-user-avatar"
    :title="email || i18nHelper.setting.account.title" :aria-label="email || i18nHelper.setting.account.title"
    aria-haspopup="menu" :aria-busy="accountMenuStore.pending" :disabled="accountMenuStore.pending" @click="openAccount">
    <template v-if="email">{{ email.charAt(0).toUpperCase() }}</template>
    <IconUser v-else :size="17" />
  </button>
</template>
