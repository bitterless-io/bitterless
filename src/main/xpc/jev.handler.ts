// PAIRED FILE — `micromeet-cowork` 有同名类,渲染端的 emitter 字符串两仓因此一致。
//
// Jev 判定的渲染进程门面。**实现不在这里** —— 在 `@main/decision/jevDecision.service`,
// 因为同一份实现还要喂给技能沙箱(那里够不到 xpc)和 ui_act 的闸(它在主进程里直接 import)。
// 这一层只做转接,不加逻辑:多一处判断就多一处「某条路忘了看开关」的可能。
//
// Registration is a pure construction side effect: the module-scope `new` registers
// `xpc:JevHandler/<method>`.
import { XpcMainHandler } from 'electron-xpc/main';
import { isJevEnabled, jevJudge } from '@main/decision/jevDecision.service';
import type { JevApi, JevRequest, JevResult } from '@shared/decision/jev.api';

export class JevHandler extends XpcMainHandler implements JevApi {
  async enabled(): Promise<boolean> {
    return await isJevEnabled();
  }

  // 一个参数(整个 request 对象)—— electron-xpc 的类型层只允许 0 或 1 个形参,
  // 第二个参数会被 Proxy 丢掉且在类型上塌成 never。
  async judge(request: JevRequest): Promise<JevResult> {
    return await jevJudge(request);
  }
}

export const jevHandler = new JevHandler();
