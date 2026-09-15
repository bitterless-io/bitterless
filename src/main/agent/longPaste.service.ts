import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 超长粘贴 → `<userData>` 下的临时文件,提示词里**只留一个绝对路径**(不带摘录)。
 *
 * Ral 2026-09-11:「当用户粘贴的文字大小超过一定 size 时 作为临时文件放到提示词中」、
 * 「需要 `<userData>` 下有目录能存放这种文件」。
 *
 * ## 为什么必须在 main 做,而且必须在这一层
 *
 * 它和「用户消息不能被压缩」是**同一条需求的两半**。既然用户原话逐字保留、永不进摘要,
 * 那么一次 80 万字符的粘贴就会**永久**占住上下文 —— 压缩帮不了它,因为压缩按设计不碰它。
 * 唯一的出路是让它一开始就不以正文形态进上下文。
 *
 * 挂在 `sendAgentMessage()` 的 `trim()` 之后:那是用户文本进入 agent 的**唯一**入口
 * (root 与 steer 两条路都经过它),也是最后一个"消息还是一个纯字符串"的地方。
 *
 * ## 为什么发绝对路径
 *
 * pi 内置 `read` 的路径解析是 `resolveToCwd(filePath, cwd)`
 * (`pi-coding-agent/dist/core/tools/path-utils.js:72`)—— 绝对路径**原样返回,没有目录限制**
 * (实测 2026-09-11)。而 `<userData>` 在工作区之外,相对路径必然解析失败。
 * 宿主自己那套受 workspace 根限制的文件工具够不到这里,所以引用里写的是给**内置 `read`** 用的
 * 绝对路径 —— 提示里也照这么说。
 *
 * ⚠ 这条**依赖内置 `read` 开着**。哪天把它从 `DEFAULT_PI_BUILTIN_TOOLS` 摘掉,这里发出去的
 * 地址就变成空头支票(和今天 `out/chain/<id>.md` 那些没人写的地址一样)。
 *
 * ## 不做的事
 *
 * **不做清理**。文件是用户原话的唯一完整副本,而会话可能几天后才被翻回来;按时间删掉它等于
 * 让历史里的引用变成死链。占用可控(阈值以上才写,一次一个文件)。真要回收,那是一个独立的
 * 保留策略,不该藏在发消息这条路上。
 */

/** `<userData>` 下的目录名。 */
export const LONG_PASTE_DIR_NAME = 'pastes';

/**
 * 触发阈值,**字符**。定义在 `shared/` —— 渲染端的原话链要用同一个数(理由见那里)。
 *
 * 取 20,000 ≈ 5k token(英文约 4 字符/token,中文更少)。这个数不是拍的,是从"留下来的代价"
 * 反推的:用户原话链的预算是 12k token,一条 5k token 的消息会**永久**吃掉其中 40%,而且
 * 因为用户消息不参与压缩,它永远不会被摘要掉。低于这个量级的粘贴留在正文里更有用 ——
 * 转成文件反而多一次工具往返。
 *
 * 用字符而不是 token:main 侧没有现成的分词器(`gpt-tokenizer` 只在渲染端),为一个阈值判定
 * 引一个分词器不值得,而字符数是确定的、跨 provider 一致的。
 */
export { LONG_PASTE_CHAR_THRESHOLD } from '@maestro-shared/longPaste.contract';
import { LONG_PASTE_CHAR_THRESHOLD } from '@maestro-shared/longPaste.contract';


export interface LongPasteResult {
  /** 交给 agent 的文本。没超阈值时**就是原文**(同一个字符串)。 */
  text: string;
  /** 写出的文件绝对路径;没超阈值时 `undefined`。 */
  path?: string;
  /** 原文字符数,仅用于日志/诊断。 */
  originalChars: number;
  /** 写盘失败时的原因;失败时 `text` 退回原文(见 `offloadLongPaste`)。 */
  error?: string;
}

/** 文件名:可读 + 唯一。会话与时间戳都进名字,方便人事后翻。 */
export const longPasteFileName = (params: { sessionId: string; now: number; seq: number }): string => {
  const safeSession = (params.sessionId || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  const d = new Date(params.now);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  return `${stamp}-${safeSession}-${params.seq}.txt`;
};

/**
 * 组装替代正文 —— **只有一条通知加一个路径,不带任何摘录**。
 *
 * Ral 2026-09-11:「摘头摘尾 就没必要了」。此前是摘头 2,000 + 摘尾 600,理由是
 * 「指令通常在开头」。取消之后引用块从约 2,600 字符降到约 300,代价是模型在读文件之前
 * **对内容一无所知** —— 它无法判断这段东西相不相关,只能读。这是他要的取舍。
 *
 * ⚠ **已知后果**:超阈值时换掉的是**整条消息**,所以「帮我看下这个日志:<200k>」里前面
 * 那句指令也一起进了文件。模型要先 `read` 才知道用户想要什么。摘头原本正是为了保住它。
 *
 * 文案直说三件事:这是替换过的、完整原文在哪、**用什么工具读**。
 * 不写「如有需要再读」这类客气话 —— 模型会把它当成可以跳过。
 */
export const renderLongPasteReference = (params: {
  original: string;
  absolutePath: string;
}): string =>
  [
    `The user's message was ${params.original.length.toLocaleString()} characters, so it was saved to a file instead of being inlined here.`,
    'The complete, unmodified text — including whatever the user is asking you to do — is at this absolute path:',
    '',
    `    ${params.absolutePath}`,
    '',
    'Read that file with the `read` tool before replying. Its content is the message. Do not ask the user to paste it again.'
  ].join('\n');

let sequence = 0;

/**
 * 超阈值就落盘并返回引用正文;否则原样返回。
 *
 * **写盘失败时退回原文**,不抛也不报错给用户:一次粘贴太大是个可以降级的情形 ——
 * 原文进上下文只是占地方,而把发送整个打断是用户能立刻看见的故障。失败原因经 `error` 带出去
 * 供上游记日志。
 */
export const offloadLongPaste = (params: {
  dir: string;
  message: string;
  sessionId?: string;
  now?: number;
  thresholdChars?: number;
}): LongPasteResult => {
  const original = params.message;
  const threshold = params.thresholdChars ?? LONG_PASTE_CHAR_THRESHOLD;
  if (original.length <= threshold) return { text: original, originalChars: original.length };

  sequence += 1;
  const name = longPasteFileName({
    sessionId: params.sessionId || 'default',
    now: params.now ?? Date.now(),
    seq: sequence
  });
  const absolutePath = join(params.dir, name);
  try {
    mkdirSync(params.dir, { recursive: true });
    writeFileSync(absolutePath, original, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    return {
      text: original,
      originalChars: original.length,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return {
    text: renderLongPasteReference({ original, absolutePath }),
    path: absolutePath,
    originalChars: original.length
  };
};
