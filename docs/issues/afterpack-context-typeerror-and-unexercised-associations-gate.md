# `afterPack` 那条用例从 9/10 红到现在:合成 context 没有 `packager`,而关联闸直接 TypeError

状态:fixed · 2026-09-14

## 现象

```text
✖ synthetic app.asar passes the desktop package audit
  TypeError: Cannot read properties of undefined (reading 'appInfo')
    at auditOnlyPreviewAssociations (scripts/package/onlyPreviewAssociations.audit.cjs:46)
    at afterPack (scripts/package/desktopPackage.audit.cjs:894)
```

`scripts/package/desktopPackageAudit.test.mjs` 里那条用例末尾调

```js
await afterPack({ appOutDir: fixture.outputPath, electronPlatformName: 'darwin', arch: 3 })
```

而 `auditOnlyPreviewAssociations(context)` 要用 `context.packager.appInfo.productFilename` 拼
`<productFilename>.app/Contents/Info.plist`。合成 context 没有 `packager` —— 于是整条用例在**还没跑到
任何断言之前**就 TypeError。

## 影响

这套用例正是发版闸(`afterPack` 由 electron-builder 调),红着等于:

1. **该用例后半段的真实断言一条都没跑**;
2. 一条长期红把新红埋掉 —— 9/14 排查打包失败时,就得先逐条确认「这条红是不是我引入的」。

另外 `auditOnlyPreviewAssociations` 对残缺 context 的失败方式是 TypeError,而不是一句能读懂的话。
同文件的 `afterPack` 对 `appOutDir` 是**显式校验 + 明确报错**的,两者不一致。

## 判断:两边都不对,但主要修测试

关联闸本身的判据(`assertOnlyPreviewAssociations`)在
[`tests/onlypreview/onlyPreviewMacOpenWith.test.mjs`](../../tests/onlypreview/onlyPreviewMacOpenWith.test.mjs)
里已被覆盖得很全:拿真实 builder 模板跑正例、五条负例、以及一条 darwin-only 的「真读最终 plist、
读完不改它」。所以缺的不是判据覆盖,而是**「`afterPack` 这条链路真的把闸接上了」**这件事 ——
此前只由一句源码正则(`assert.match(hook, /auditOnlyPreviewAssociations/)`)间接保证。

因此不选「让关联闸在 context 残缺时跳过」:那会把闸从 afterPack 链路上摘掉,正是本该被断言的东西。

## 修复

1. `onlyPreviewAssociations.audit.cjs`:mac/mas 路径上**显式校验 context**,缺 `appOutDir` 或
   `packager.appInfo.productFilename` 时抛一句能读懂的话,与 `afterPack` 对 `appOutDir` 的做法一致。
   非 mac 平台依旧提前返回,不做任何校验(win32 调用方保持原样)。
2. 合成产物补上 `Contents/Info.plist` —— 内容由 `electron-builder.tmp.yml` 的
   `mac.extendInfo.CFBundleDocumentTypes` 生成,即闸真正要读的那份东西。
3. 那条大用例只保留它自己的结果断言;`afterPack` 拆成两条独立用例:
   - **darwin-only**:完整 context + 真 plist 跑完整条 `afterPack`,然后**把 plist 里的
     `public.data` 改坏,断言它必须红** —— 这条反向锁才是「闸确实接在 afterPack 上」的证据,
     光看不抛错证明不了什么(闸被摘掉时同样不抛错);
   - **跨平台**:context 残缺时报的是那句明确的话,而不是 TypeError。

## 判据

`node --test scripts/package/desktopPackageAudit.test.mjs` 全绿;
`node --test tests/onlypreview/onlyPreviewMacOpenWith.test.mjs` 不受影响(含它那条
`audit({ electronPlatformName: 'win32' })` 的提前返回)。
