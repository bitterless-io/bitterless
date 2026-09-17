import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 跨进程边界不许递响应式引用（Ral 2026-09-10：「发个消息都没回复,一直 Sent · waiting…」）。
 *
 * 根因：`session` 住在 `reactive()` 里，所以 `session.detail.workspace` 是一个 **Proxy**，
 * 而 Proxy **过不了 structured clone**。递过去的后果是整次调用在边界上抛
 * `An object could not be cloned.`（37 字符，正是日志里那条被脱敏成 `***` 的消息），
 * 消息**根本没离开渲染进程** —— 所以 main 侧一行日志都没有、耗时 0ms。
 *
 * 它坏在两处，症状完全不同、都很隐蔽：
 *  · `buildAgentContext` → `sendAgentMessage`：发消息永远没回复；
 *  · `toStoredSession` → `saveSession`：会话**静默存不进库**（`persistSession`
 *    的 catch 是「best effort」的空吞，把那个异常吃掉了）。
 *
 * 而且它只在**绑定了工作区之后**才发作 —— 没绑时 `workspace` 是 `undefined`，可克隆。
 * 所以它看起来像"突然坏了"，而不是一直坏。
 *
 * 这个测试对源码断言：那两处必须走 `cloneWorkspace()`。行为断言在这里做不到 ——
 * 触发它需要真的 Electron IPC。
 */

const root = resolve(import.meta.dirname, '../..');
const src = readFileSync(resolve(root, 'src/renderer/maestro/control/src/store/message.store.ts'), 'utf8');

/** 取一个方法的函数体（到下一个同缩进的 `}`）。 */
const bodyOf = (name) => {
  const at = src.indexOf(name);
  assert.ok(at > 0, `找不到 ${name} —— 断言失去作用域，先修断言`);
  const end = src.indexOf('\n  }', at);
  return src.slice(at, end);
};

test('buildAgentContext 递给 main 的 workspace 必须是 clone', () => {
  const body = bodyOf('buildAgentContext(session: MessageSession');
  assert.match(
    body,
    /workspace: this\.cloneWorkspace\(session\.detail\.workspace\)/,
    'workspace 必须 clone —— 直接递响应式 Proxy 会让 sendAgentMessage 在跨进程边界抛 An object could not be cloned.',
  );
  assert.doesNotMatch(
    body,
    /workspace: session\.detail\.workspace\b/,
    '不许按引用递',
  );
});

test('toStoredSession 落库的 workspace 必须是 clone', () => {
  const body = bodyOf('toStoredSession(session: MessageSession');
  assert.match(
    body,
    /workspace: this\.cloneWorkspace\(session\.detail\.workspace\)/,
    'saveSession 也是跨进程边界 —— 递 Proxy 会让持久化静默失败(persistSession 吞掉了那个异常)',
  );
});

test('cloneWorkspace 真的产出新对象（不是原样返回）', () => {
  const body = bodyOf('cloneWorkspace(workspace?: WorkspaceRef)');
  assert.match(body, /\{ \.\.\.workspace \}/, '必须浅拷贝出一个纯对象');
  assert.doesNotMatch(body, /return workspace\b(?!\s*\?)/, '不许把入参原样返回');
});

test('这条要求写在代码里，不只写在这个测试里', () => {
  assert.match(
    src,
    /structured clone/i,
    '成因必须留在代码注释里 —— 下一个人看到 `this.cloneWorkspace(...)` 会觉得它是多余的,顺手改回引用',
  );
});

/**
 * 扫**整个 control renderer**，而不是只扫 message.store.ts（Ral 2026-09-17：
 * 「bl yarn dev:prod 启动 chat 窗口报错，之前是好的」）。
 *
 * 上面那四条断言写死了 message.store.ts 一个文件。2026-09-16 的 `a7373413` 在
 * **channel.store.ts** 加了第三个调用点 —— `void coach.setSkillViewContext({ sessionId,
 * workspace: this.activeSession?.detail.workspace })` —— 守卫看不见它，六天后同一个错误
 * (`An object could not be cloned.`) 原样复发，这次卡在 `loadControlConfig` 的启动路径上。
 *
 * 所以扫描面必须是目录级的：任何把 `.detail.workspace` / `.workspace` 直接作为 `workspace:`
 * 值递出去的写法都失败，只接受浅拷贝（`{ ...x }`）或 `cloneWorkspace(...)`。
 */
const controlDir = resolve(root, 'src/renderer/maestro/control/src');

const controlSources = () => {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|vue)$/.test(entry.name)) out.push([full, readFileSync(full, 'utf8')]);
    }
  };
  walk(controlDir);
  return out;
};

/**
 * 只看**真的过边界**的那些调用，不看渲染端自己的赋值。
 *
 * `session.detail = { ...session.detail, workspace: result.workspace }` 也长得像"按引用递
 * workspace"，但它是把 main 回来的纯对象写进本地响应式状态 —— 完全正常。按行做正则会把它
 * 误报成缺陷，于是守卫要么被加豁免名单、要么被关掉,两条都会让它失去作用。
 *
 * 所以边界从源码里**自己认**：xpc emitter 是 `createXpcRendererEmitter` 建出来的那些常量，
 * 只检查 `<emitter>.<method>( … )` 的实参文本。
 */
const emitterNamesIn = (text) =>
  [...text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*createXpcRendererEmitter/g)].map((m) => m[1]);

/**
 * emitter 还有一种**不落常量**的写法,直接链式调用:
 * `void createXpcRendererEmitter<Contract>('Handler').someMethod({ … })`。
 *
 * BL 的 control renderer 现在一处都没有,但 micromeet-cowork 的 `channel.store.ts` 的 `setActive()`
 * 正是这种 —— 也就是说"只认常量声明"是个**真实存在过的盲区**,只是碰巧没落在 BL 这边。
 * 两边守卫保持同一识别口径,免得下一次复发挑那个项目发生。
 * (Ral 2026-09-17;cowork 侧对应 apps/cowork/tests/unit/xpcPayloadCloneable.test.mjs)
 */
const INLINE_EMITTER = /createXpcRendererEmitter\s*(?:<[^>]*>)?\s*\([^()]*\)\s*\.[\w$]+\s*\(/;

/** 一个文件里所有 xpc 调用的 `(` 位置 —— 两种 emitter 写法都算。 */
const xpcCallSites = (text) => {
  const sites = [];
  for (const match of text.matchAll(new RegExp(INLINE_EMITTER.source, 'g'))) {
    sites.push({ open: match.index + match[0].length - 1, index: match.index, text: match[0] });
  }
  for (const emitter of emitterNamesIn(text)) {
    for (const match of text.matchAll(new RegExp(`\\b${emitter}\\.[\\w$]+\\s*\\(`, 'g'))) {
      sites.push({ open: match.index + match[0].length - 1, index: match.index, text: match[0] });
    }
  }
  return sites;
};

/**
 * `workspace:` 后面直接跟成员表达式 —— 不是 `{ ...`、不是 `cloneWorkspace(`、不是 undefined。
 *
 * **必须是模块级的这一个**:扫描器和下面那条反向自检要共用它。原来两处各自 `const byReference = …`
 * 声明了一份同样的正则,于是有人把扫描器那份改松时,自检拿的还是自己那份完好的副本 —— 照样绿,
 * 而"守卫不是恒真"这个保证就悄悄没了。共用一个对象,改松了自检立刻跟着红。
 */
const BY_REFERENCE =
  /workspace:\s*(?!\{)(?!undefined\b)(?!cloneWorkspace\()[A-Za-z_$][\w$.?![\]]*\.workspace\b/;

/** 从 `(` 开始取到配对的 `)`（够用即可：这些实参里没有含括号的字符串字面量）。 */
const argumentsAt = (text, open) => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return '';
};

test('xpc 调用的实参里没有按引用递的 workspace', () => {
  // `workspace:` 后面直接跟成员表达式 —— 不是 `{ ...`、不是 `cloneWorkspace(`、不是 undefined。
  const offenders = [];
  for (const [file, text] of controlSources()) {
    for (const site of xpcCallSites(text)) {
      if (!BY_REFERENCE.test(argumentsAt(text, site.open))) continue;
      const line = text.slice(0, site.index).split('\n').length;
      offenders.push(`${file.slice(root.length + 1)}:${line}  ${site.text}…`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '这些 xpc 调用把响应式 workspace Proxy 直接递过了边界 —— 会抛 An object could not be cloned.：\n' +
      offenders.join('\n'),
  );
});

test('守卫认得出边界，也认得出那一行缺陷', () => {
  // 反向自检：守卫必须能判 2026-09-16 那行(a7373413, channel.store.ts:53)有罪，
  // 又必须放过"把 main 回来的对象写进本地状态"这种正常写法。否则它只是恒真。
  assert.ok(
    BY_REFERENCE.test('{ sessionId, workspace: this.activeSession?.detail.workspace }'),
    '守卫判不出复发的那一行 —— 它是恒真的，先修守卫',
  );
  assert.ok(
    !BY_REFERENCE.test('{ sessionId, workspace: workspace ? { ...workspace } : undefined }'),
    '浅拷贝不该被判有罪',
  );
  assert.ok(
    !BY_REFERENCE.test('{ sessionId, workspace: this.cloneWorkspace(session.detail.workspace) }'),
    'cloneWorkspace 不该被判有罪',
  );
});

test('两种 emitter 写法都在识别口径里', () => {
  // 不落常量的链式调用必须也被认出来 —— 这是 cowork 那边的真实写法。
  assert.ok(
    new RegExp(INLINE_EMITTER.source).test(
      "void createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler').setSkillViewContext({ sessionId })",
    ),
    '内联 emitter 调用没被认出来 —— 这一整类调用会是守卫的盲区',
  );
  // 常量声明那一种当然也要还在。
  assert.ok(
    controlSources().some(([, text]) => xpcCallSites(text).length > 0),
    'control renderer 里一个 xpc 调用都没认出来 —— emitter 识别坏了',
  );
});

test('守卫扫的是整个目录，不是单个文件', () => {
  const files = controlSources();
  assert.ok(files.length > 5, `只扫到 ${files.length} 个文件 —— 扫描面塌了，先修断言`);
  assert.ok(
    files.some(([file]) => file.endsWith('store/channel.store.ts')),
    'channel.store.ts 必须在扫描面里 —— 2026-09-16 的复发正是从它溜过去的',
  );
});
