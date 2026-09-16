# Windows/Linux 打包会把中文和英文语言包剪掉

状态:open(**未修**) · 2026-09-16 · 由 `asar-packs-the-build-toolchain` 的对抗式复核顺带查出

> 这是一个**先于**打包瘦身就存在的缺陷,和那次改动无关,但它决定了 Windows 的 `.app` 体积数,
> 所以在这里单独立档。未修 —— 改它需要一次真实 Windows 打包来验证,不能靠猜。

## 现象(预测,尚未实测)

`electron-builder.tmp.yml` 顶部的语言白名单:

```yaml
electronLanguages:
  - zh_CN
  - zh_TW
  - ja
  - en
  - id
  - ko
  - fr
```

macOS 上这是对的 —— 实测产物里正好是 `en.lproj` `fr.lproj` `id.lproj` `ja.lproj` `ko.lproj`
`zh_CN.lproj` `zh_TW.lproj` 七个。

但 Windows / Linux 上,预计会**只剩 `ja` `id` `ko` `fr` 四个**,中文和英文全被剪掉。

## 原因

`node_modules/app-builder-lib/out/electron/ElectronFramework.js`:

```js
// :75  mac
return { dirs: [...], langFileExt: ".lproj" };
// :77  其它平台
return { dirs: [path.join(packager.getResourcesDir(appOutDir), "..", "locales")], langFileExt: ".pak" };

// :64-65
const language = path.basename(file, langFileExt);
if (!wantedLanguages.includes(language)) { /* 删掉 */ }
```

匹配是**字面量 `includes`**,而两个平台的语言文件命名规则不同:

| 白名单写的 | macOS 实际文件 | Windows 实际文件 | Windows 是否命中 |
|---|---|---|---|
| `zh_CN` | `zh_CN.lproj` ✓ | `zh-CN.pak` | ✗ 下划线 vs 连字符 |
| `zh_TW` | `zh_TW.lproj` ✓ | `zh-TW.pak` | ✗ |
| `en` | `en.lproj` ✓ | `en-US.pak` / `en-GB.pak` | ✗ 无裸 `en` |
| `ja` `id` `ko` `fr` | ✓ | `ja.pak` 等 | ✓ |

一份白名单不可能同时对两种命名成立。

## 修法(未执行)

`ElectronFramework.js:53` 读的是
`platformSpecificBuildOptions.electronLanguages || config.electronLanguages`
—— **平台键优先于顶层键**。所以把列表拆成 `mac:` 和 `win:`(以及将来的 `linux:`)两份,
各写各的命名。

两件事必须先做,否则就是拿猜的清单换掉一份至少在 mac 上正确的清单:

1. 真打一次 Windows 包,列出 `resources/../locales/` 下 Electron 40 实际发的 `.pak` 文件名,
   确认是 `zh-CN` / `en-US` 还是别的写法。
2. 决定英文取 `en-US` 还是连 `en-GB` 一起留。

改完要同步 `scripts/package/desktopPackageAudit.test.mjs` 里的
`assertExactElectronLanguages` —— 它现在断言模板和生成配置里是那**一份**七项列表。

## 和体积闸门的关系

这条会影响 Windows 的 `.app` 体积:剪不掉的语言包会让它涨,剪对了又会回落几 MiB。
所以 `desktopPackage.audit.cjs` 里 `win32/x64` 的应用体积闸门**故意保持 650 MiB 不动**,
等真打一次 Windows 包、并且这条修掉之后,再用实测数重定。
参见 [`asar-packs-the-build-toolchain.md`](asar-packs-the-build-toolchain.md) #4(a)。
