import { xpcCenter } from 'electron-xpc/main';
import { initTestHandler } from './test.handler';
import { initTestSubscriber } from './test.subscriber';
import { initUpdateHandler } from './update.handler';
// 上下文压缩 —— **凡调 pi 的都在那个 handler 里**(渲染端 import pi 会拿到空壳,见文件头)。
// 注册是纯构造副作用:`new CompactionHandler()` 在模块作用域自动注册 `xpc:CompactionHandler/*`,
// 所以这里只需要一条 side-effect import,不 import 它导出的那个绑定。
// 放在根 xpc 树而不是 maestro 那棵:三个已迁入的模块按 `main/xpc/compaction.handler.ts` 这个
// 路径引用它(runtime.types / compactionRun / piRuntimeAdapter),挪走会当场让那三处注释变成谎。
import './compaction.handler';
import './workflow.handler';
import './pluginTest.handler';
import './todoWindow.handler';
import './eyesOnAgentsWindow.handler';
import './eyesOnAgents.handler';
import './submodulesWindow.handler';
import './submodulesSystem.handler';
import './submodules.handler';
import './zellij.handler';
import './zellijWindow.handler';
import './omniWindow.handler';
import './shell.handler';
import './lanIp.handler';
import './sqlitePassword.handler';
import './mainWindow.handler';
import './auth.handler';
import './mcp.handler';
import './coinWindow.handler';
import './trench.handler';
import './trenchIoSystem.handler';
import './maestroWindow.handler';
import './applicationLanguage.handler';
import './todoSystem.handler';
import './modelProvider.handler';
import './translator.handler';
import './diagnostics.handler';
import './notification.handler';
import './onlyPreview.handler';
import './onlyPreviewAlert.handler';
import { initMaestroXpc } from '@maestro-main/xpc/xpc.helper';

export const initXpc = (): void => {
  xpcCenter.init();
  initMaestroXpc();
  initTestHandler();
  initTestSubscriber();
  initUpdateHandler();
};
