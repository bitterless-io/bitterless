<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { pathHelper } from '@shared/pathHelper/renderer/pathRenderer.helper';

class DebugStore {
  env = import.meta.env.VITE_ENV || '';
  appPath = '';
  userDataPath = '';
  chromiumPath = '';
}

const store = reactive<DebugStore>(new DebugStore());

onMounted(async () => {
  store.appPath = await pathHelper.getAppPath();
  store.userDataPath = await pathHelper.getUserDataPath();
  store.chromiumPath = (await pathHelper.getChromiumPath()) || '(not found)';
  xpcRenderer.handle('renderer/hello', async (payload) => {
    console.log(payload);
    return 'hello from renderer';
  });
  xpcRenderer.handle('renderer/roger', async (payload) => {
    console.log(payload);
  });
});

const testInvalid = async () => {
  console.log('[testInvalid] sending to main process...');
  const result = await xpcRenderer.send('testInvalid');
  console.log('[testInvalid] result:', result);
};

const testSqliteHello = async () => {
  console.log('[testSqliteHello] sending sqlite/hello...');
  const result = await xpcRenderer.send('sqlite/hello');
  console.log('[testSqliteHello] result:', result);
};

const testUtilityProcess = async () => {
  console.log('[testUtilityProcess] sending test/hello...');
  const result = await xpcRenderer.send('test/hello');
  console.log('[testUtilityProcess] result:', result);
};

const testBroadcast = () => {
  console.log('[testBroadcast] broadcasting hi_everyone...');
  xpcRenderer.broadcast('hi_everyone', { message: 'hi from home' });
};

const openOmniWindow = async () => {
  console.log('[openOmniWindow] opening...');
  await xpcRenderer.send('OmniWindowHandler/openOmniWindow');
  console.log('[openOmniWindow] done');
};

const openFolder = async (path: string) => {
  if (!path) return;
  try {
    const result = await pathHelper.openPath({ path });
    if (result !== '') {
      console.error('[openFolder] failed:', result);
    }
  } catch (err: any) {
    console.error('[openFolder] error:', err.message);
  }
};
</script>

<template>
  <div class="debug full-container">
    <div class="debug__section">
      <div class="debug__section__title">环境变量</div>
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="env">{{ store.env }}</a-descriptions-item>
      </a-descriptions>
    </div>

    <div class="debug__section">
      <div class="debug__section__title">应用目录</div>
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="App Path">
          <span class="debug__path" @click="openFolder(store.appPath)">{{ store.appPath }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="User Data Path">
          <span class="debug__path" @click="openFolder(store.userDataPath)">{{ store.userDataPath }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="Chromium Path">
          <span class="debug__path">{{ store.chromiumPath }}</span>
        </a-descriptions-item>
      </a-descriptions>
    </div>

    <div class="debug__section">
      <div class="debug__section__title">冒烟调试</div>
      <div class="debug__section__actions">
        <a-button type="primary" @click="testInvalid">测试无效监听</a-button>
        <a-button type="primary" @click="testSqliteHello">测试 SQLite 监听</a-button>
        <a-button type="primary" @click="testUtilityProcess">测试 Utility 进程通信</a-button>
        <a-button type="primary" @click="testBroadcast">测试广播</a-button>
        <a-button type="primary" @click="openOmniWindow">打开 Omni Window</a-button>
      </div>
    </div>
  </div>
</template>

<style lang="less">
@import './Debug.less';
</style>
