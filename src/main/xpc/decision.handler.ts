// PAIRED FILE — `micromeet-cowork` 有同名类,渲染端的 emitter 字符串两仓因此一致。
//
// decision helper 的渲染进程门面(docs/features/decision-helper.md #4,原来叫 JevHandler,没有调用方)。
// **实现不在这里** —— 在 `@main/decision/decisionHelper`,因为同一份实现还要喂给技能沙箱(那里够不到 xpc)
// 和 ui_act 的闸(它在主进程里直接 import)。这一层只做转接,不加逻辑:多一处判断就多一处「某条路忘了看开关」的可能。
//
// electron-xpc 的方法只允许 0 或 1 个形参(第二个会被 Proxy 丢掉,类型上塌成 never),所以渲染层
// (`renderer/common/decision/decisionHelper.ts`)把参数打包成一个对象送来,这里原样拆开。
//
// Registration is a pure construction side effect: the module-scope `new` registers
// `xpc:DecisionHandler/<method>`. 类名即通道名,改名会静默断掉渲染层。
import { XpcMainHandler } from 'electron-xpc/main';
import { decisionHelper } from '@main/decision/decisionHelper';
import type {
  DecisionApi,
  DecisionAskParams,
  DecisionJudgeParams,
  DecisionOutcome
} from '@shared/decision/decision.api';
import type {
  JevChoiceQuestion,
  JevNoulQuestion,
  JevResult,
  JevScoreQuestion
} from '@shared/decision/jev.api';

export class DecisionHandler extends XpcMainHandler implements DecisionApi {
  async enabled(): Promise<boolean> {
    return await decisionHelper.enabled();
  }

  async judge(params: DecisionJudgeParams): Promise<JevResult> {
    return await decisionHelper.judge(params.request, params.options);
  }

  async choose(params: DecisionAskParams<JevChoiceQuestion>): Promise<DecisionOutcome<string>> {
    return await decisionHelper.choose(params.question, params.state, params.options);
  }

  async check(params: DecisionAskParams<JevNoulQuestion>): Promise<DecisionOutcome<boolean>> {
    return await decisionHelper.check(params.question, params.state, params.options);
  }

  async score(params: DecisionAskParams<JevScoreQuestion>): Promise<DecisionOutcome<number>> {
    return await decisionHelper.score(params.question, params.state, params.options);
  }
}

export const decisionHandler = new DecisionHandler();
