import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import test, { describe } from 'node:test';
import { build } from 'esbuild';

const root = resolvePath(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolvePath(root, path), 'utf8');

/**
 * 地址栏吃一条本机绝对路径(Ral 2026-09-09,`docs/features/address-bar-local-path.md`)。
 *
 * 判据本身是两仓共用的那一份(`@shared/onlypreview/onlyPreviewTargetInput`),所以这里两件事都要测:
 * ① 那份判据的边界 —— 它是**两个 app 的地址栏**共同依赖的,判错的代价在两边同时发生;
 * ② 本仓的落点 —— **在** → OnlyPreview 独立窗口,**不在** → 一发 `file://` 让 Chromium 出它自己
 *    的「文件不存在」页。把不存在判成存在,操作者看到的是一个空预览面而不是"文件不存在"。
 */
const compiled = await build({
  stdin: {
    contents: [
      "export { isAbsoluteFilePath } from './src/shared/onlypreview/onlyPreviewTargetInput.ts';",
      "export { resolveLocalPathTarget } from './src/main/windows/onlyPreviewLocalPathTarget.ts';"
    ].join('\n'),
    resolveDir: root
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolvePath(root, 'tsconfig.node.json'),
  external: ['electron']
});
const { isAbsoluteFilePath, resolveLocalPathTarget } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

/** 只认这几条存在 —— 不碰真实文件系统,所以这张表就是"文件系统"。 */
const withExisting = (...paths) => {
  const set = new Set(paths);
  return (path) => set.has(path);
};

const PATHS = [
  '/Users/ral/Documents/projects/overmind/tmp/wecom-markdown-v2-doc.html',
  '/Users/ral/x.pdf',
  '/tmp',
  '/Users/ral/My Documents/a.html',
  '/Users/ral/项目/说明.md',
  'C:\\Users\\ral\\x.html',
  'c:/Users/ral/x.html',
  'D:\\a b\\c.pdf',
  '\\\\server\\share\\x.docx'
];

const NOT_PATHS = [
  '',
  '   ',
  'example.com',
  'https://example.com',
  'file:///Users/ral/x.pdf',
  'localhost:5173',
  // 单字母主机 ＋ 端口:盘符只有在后面跟了分隔符时才是盘符,否则这是一台主机
  'c:8080',
  'cors 怎么配',
  'Users/ral/x.html',
  // 协议相对写法与单独一个斜杠都不算路径
  '//example.com',
  '/',
  '//'
];

describe('isAbsoluteFilePath(两仓共用的判据)', () => {
  test('两个平台的绝对路径都认,不管当前跑在哪个平台', () => {
    for (const value of PATHS) assert.ok(isAbsoluteFilePath(value), value);
  });

  test('地址、搜索词、相对路径都不是绝对路径', () => {
    for (const value of NOT_PATHS) assert.ok(!isAbsoluteFilePath(value), JSON.stringify(value));
  });

  test('带空格的路径算路径 —— 这条是它区别于"有空白就不是地址"的地方', () => {
    assert.ok(isAbsoluteFilePath('/Users/ral/My Documents/a.html'));
    assert.ok(isAbsoluteFilePath('D:\\a b\\c.pdf'));
  });

  test('null / undefined 不抛', () => {
    for (const value of [undefined, null]) assert.equal(isAbsoluteFilePath(value), false);
  });
});

describe('resolveLocalPathTarget', () => {
  test('文件在 → preview,交出去的是归一后的路径', () => {
    // 用 `.docx`:`.html` 现在落的是 `chrome`(普通 tab 自己能渲染),见下面那一组
    assert.deepEqual(resolveLocalPathTarget('/Users/ral/x.docx', withExisting('/Users/ral/x.docx')), {
      kind: 'preview',
      path: '/Users/ral/x.docx'
    });
  });

  test('目录同样是 preview —— OnlyPreview 有正式的 directory adapter', () => {
    assert.equal(
      resolveLocalPathTarget('/Users/ral/Documents', withExisting('/Users/ral/Documents')).kind,
      'preview'
    );
  });

  test('文件不在 → missing,且给的是一个 Chromium 真能吃的 file:// URL', () => {
    const target = resolveLocalPathTarget('/Users/ral/nope.html', withExisting());
    assert.equal(target.kind, 'missing');
    assert.equal(target.fileUrl, 'file:///Users/ral/nope.html');
    assert.equal(new URL(target.fileUrl).protocol, 'file:');
  });

  test('空格与中文进 URL 时被编码,而不是把 URL 截断', () => {
    const target = resolveLocalPathTarget('/Users/ral/My Docs/说明.md', withExisting());
    assert.ok(!target.fileUrl.includes(' '), target.fileUrl);
    assert.equal(decodeURIComponent(new URL(target.fileUrl).pathname), '/Users/ral/My Docs/说明.md');
  });

  test('归一在存在性判断之前 —— `..` 与重复斜杠不该让一个真文件被判成不存在', () => {
    const exists = withExisting('/Users/ral/x.html');
    assert.equal(resolveLocalPathTarget('/Users/ral/sub/../x.html', exists).kind, 'preview');
    assert.equal(resolveLocalPathTarget('/Users//ral///x.html', exists).kind, 'preview');
  });

  test('mac 上的 Windows 路径落 missing,不落 preview', () => {
    assert.equal(resolveLocalPathTarget('C:\\Users\\ral\\x.html', withExisting()).kind, 'missing');
  });

  test('不是绝对路径 → `null`（「不是我的」）', () => {
    // **这一条守着一个静默缺陷**:`resolve('')` 是当前工作目录,而它一定存在 —— 少了前置判断,
    // 空输入会变成"预览 cwd"。所以这里的 exists 故意说"什么都在"。
    //
    // 返回值从早先的 `{ kind: 'missing', fileUrl: '' }` 换成 `null`:端口需要一个明确的
    // 「不是本机路径」答案,空串哨兵跨边界读不出这个意思(`MaestroPreviewOpener.resolveLocalTarget`)。
    const everythingExists = () => true;
    for (const value of ['', '   ', 'example.com', 'Users/ral/x.html']) {
      assert.equal(resolveLocalPathTarget(value, everythingExists), null, JSON.stringify(value));
    }
  });

  test('默认用真实的 existsSync', () => {
    assert.equal(resolveLocalPathTarget(resolvePath(root, 'package.json')).kind, 'preview');
    assert.equal(resolveLocalPathTarget(resolvePath(root, 'no-such-file-ea91.json')).kind, 'missing');
  });
});

/**
 * maestro 那一侧的接线 —— 现在走**宿主的预览端口**。
 *
 * 早先这里是 maestro 直接 import `@shared/onlypreview/*` 与 `@main/miniapps/onlypreview/*`。
 * `check:maestro` 的别名边界拦下了它,而且那些 import 还把宿主整棵 onlypreview 子树(连 fileSearch /
 * menu)拖进了 maestro 的测试打包,`maestroCompositeTabNavigation` 直接在 esbuild 阶段挂掉。
 * 所以守卫反过来写:**maestro 里不许出现任何 onlypreview 别名**。
 */
describe('maestro navigate 走预览端口', () => {
  const source = read('src/main/maestro/windows/main/maestroBrowserView.service.ts');
  /**
   * 别名边界要在**剥掉注释之后**断言。
   *
   * 那个文件里有一句注释解释「maestro 曾经直接 import `@shared/onlypreview/*`,现在刻意不去问」——
   * 一条朴素的 `doesNotMatch` 会把这句**解释**当成违规,于是守卫对着一段正确的代码报红
   * (2026-09-11 真的发生了一次)。注释里提到一个别名是好事,不是违规;要禁的是 import。
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const navigate = source.slice(
    source.indexOf('async navigate('),
    source.indexOf('async reload(')
  );

  test('本机路径的判据与落法都问端口,不自己判', () => {
    assert.match(navigate, /getMaestroPreviewOpener\(\)/);
    assert.match(navigate, /resolveLocalTarget\(raw\)/);
    assert.match(navigate, /localTarget\?\.kind === 'preview'[\s\S]{0,220}\.open\(localTarget\.path\)/);
  });

  test('路径那一支不过 normalizeUrl —— 否则被补成 https:///Users/…', () => {
    assert.match(navigate, /localTarget \? localTarget\.fileUrl : normalizeUrl\(params\.url\)/);
  });

  test('maestro 里不出现任何 onlypreview 别名 —— 这是别名边界,不只是风格', () => {
    assert.doesNotMatch(code, /@shared\/onlypreview\//);
    assert.doesNotMatch(code, /@main\/miniapps\/onlypreview\//);
    // 注释里提到那两个别名是**允许**的 —— 那是解释,不是 import。钉一下,免得下次有人把 code
    // 换回 source 来"简化"。

    assert.doesNotMatch(navigate, /\[A-Za-z\]:/, 'navigate 里出现盘符正则 = 判据被复制了一份');
  });
});

describe('宿主那一侧实现端口', () => {
  const opener = read('src/main/windows/onlyPreviewMaestroOpener.ts');

  test('端口的 resolveLocalTarget 由宿主的解析器实现', () => {
    assert.match(opener, /resolveLocalTarget: \(input: string\) => resolveLocalPathTarget\(input\)/);
    assert.match(opener, /from '@main\/windows\/onlyPreviewLocalPathTarget'/);
  });

  test('解析器住在宿主侧 —— maestro 那棵树里不该再有它', () => {
    assert.doesNotMatch(opener, /maestro\/windows\/main\/localPathTarget/);
  });
});

/**
 * 第三个落点:**普通 tab 自己就能渲染** 的本机文件(Ral 2026-09-09:「这个文件不会进入 onlypreview
 * 的预览,而是 new tab 打开一个页面去单独预览」)。
 *
 * 判错两边都有代价:该进 tab 的进了 OnlyPreview = 他明确不要的行为;该进预览面的落到 `file://` =
 * docx 会被浏览器**下载**下来,markdown 会变成一坨没渲染的纯文本。
 */
describe('所有本机文件格式共用预览路由', () => {
  const exists = () => true;

  test('PDF 交给统一预览路由', () => {
    const target = resolveLocalPathTarget(
      '/Users/ral/Downloads/NOTE_voice_scribe_regional_language_2026-09-08.pdf',
      exists
    );
    assert.equal(target.kind, 'preview');
    assert.ok(target.path.endsWith('.pdf'));
  });

  test('pdf / 图片 / 音视频 / html 都落 preview', () => {
    for (const path of ['/x/a.pdf', '/x/a.png', '/x/a.jpg', '/x/a.mp3', '/x/a.mp4', '/x/a.html', '/x/a.htm']) {
      assert.equal(resolveLocalPathTarget(path, exists).kind, 'preview', path);
    }
  });

  test('需要预览组件的仍落 preview —— 落 chrome 会变成"下载"或"没渲染的纯文本"', () => {
    for (const path of ['/x/a.docx', '/x/a.xlsx', '/x/a.pptx', '/x/a.drawio', '/x/a.md', '/x/a.ts', '/x/a.json']) {
      assert.equal(resolveLocalPathTarget(path, exists).kind, 'preview', path);
    }
  });

  test('目录落 preview —— 普通 WebContents 只会给一个文件列表', () => {
    assert.equal(resolveLocalPathTarget('/Users/ral/Documents', exists).kind, 'preview');
  });

  test('不存在优先于格式判定 —— 一个不存在的 pdf 是 missing,不是 chrome', () => {
    assert.equal(resolveLocalPathTarget('/x/nope.pdf', () => false).kind, 'missing');
  });
});
