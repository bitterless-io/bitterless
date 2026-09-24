import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { DecisionApi, DecisionHelper } from '@shared/decision/decision.api';

/**
 * 渲染进程的 decision helper(docs/features/decision-helper.md #2 #4):签名与主进程的 `decisionHelper` 相同
 * (同一个 `DecisionHelper` 接口),**业务代码只 import 这个模块**,不直接碰 xpc 通道名。
 *
 * 实现在主进程 —— 登录 token 只在那里,阈值的判断也只在那里。这里只做一件事:把参数原样带过去、把结果原样交回,
 * `options`(含 `threshold`)一个字段都不看。xpc 的方法只能有 0 或 1 个形参,所以位置参数装进一个对象。
 *
 * 通道名是主进程的类名 `DecisionHandler`(`main/xpc/decision.handler.ts`),改名会静默断掉这里。
 */
const channel = createXpcRendererEmitter<DecisionApi>('DecisionHandler') as DecisionApi;

export const decisionHelper: DecisionHelper = {
  enabled: () => channel.enabled(),
  judge: (request, options) => channel.judge({ request, options }),
  choose: (question, state, options) => channel.choose({ question, state, options }),
  check: (question, state, options) => channel.check({ question, state, options }),
  score: (question, state, options) => channel.score({ question, state, options })
};
