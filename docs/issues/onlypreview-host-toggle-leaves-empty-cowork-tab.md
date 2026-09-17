# The host toggle leaves an empty Cowork tab behind, and standalone does not take effect

> **Status, 2026-09-17:** the "close the tab on undock" half of this page is **reversed** — see
> [Reversal (2026-09-17)](#reversal-2026-09-17) at the bottom and
> [task 181](../plan/tasks/onlypreview-deferred-tab-placeholder-181.md). Symptom 2's analysis below is
> still an accurate account of the code as it stood, and is kept for that reason.

Reported by Ral 2026-09-07, against **both** bitterless and the micromeet-cowork port:
「onlypreview toggle 独立窗口打开没生效，另外注意独立窗口打开，浏览器里的 tab 就得关掉」.

Fix belongs here. `onlyPreviewHostToggle.service.ts` is bitterless code; the cowork port vendors it
(PQ-4 is single-direction), so patching it there would produce exactly the drift that policy exists
to prevent.

## Symptom 2 — the tab already IS closed on undock. Nothing to do in bitterless.

> **Correction 2026-09-07.** This section first claimed the undock direction had no tab-closing
> counterpart and needed one. That was wrong, and it is recorded rather than deleted because acting
> on it would have added a second, redundant close path to a transition that is already delicate.

`destroyStandalone()` closes the carrier through the mount, and says so on the line above it
(`onlyPreviewWindow.helper.ts`):

```ts
// The host goes down the way this host goes down — the standalone window is destroyed, a Cowork
// tab is closed — and only then are the mount's own listeners released.
mount?.destroyHost();
mount?.dispose();
```

`OnlyPreviewCoworkMount.destroyHost()` is `this.deps.close()`, i.e. "close this tab". So the mount
seam is exactly what makes one call mean "destroy the window" in one host and "close the tab" in the
other — which is the design working, not a gap.

**One real caveat, and it is cowork-only.** There, `deps.close()` lands on
`BrowserController.closeTab`, which silently refuses in two cases: `tabs.length <= 1`, and a
`pinned` tab. So if OnlyPreview were ever the only tab, undocking would leave its tab behind and
the refusal would be invisible. Today the pinned first tab guarantees `length >= 2`, so it does
not bite — but it is a latent edge, and the same silent-refusal behaviour is what
`closeActiveTab` had to work around for Cmd+W (it now hides the window when the close does not
happen). If this ever needs hardening, the check belongs behind `onlyPreviewDockHost`, not in the
vendored service.

## Symptom 1 — "standalone does not take effect". NOT yet diagnosed.

Stated honestly: I have not reproduced this one, and the leftover tab above does not explain it.

What to check first, in order:

1. **Does `toggle()` even run?** `getState()` gates the button on `canDock`, and the shell disables
   it via `onlyPreviewShellStore.hostToggle.disabled`. If `pending` never clears, the button stays
   disabled after the first press and a second press is a silent no-op.
2. **Does `relocate()` throw and silently recover?** Its `catch` rebuilds the host on `sourceKind`
   and calls `recordFailure`, so a failed undock **looks like nothing happened** — the composite is
   back where it started and the only trace is `writeOperationFailure` in the OnlyPreview log plus
   `failure` in the next `getState()`. Read `<userData>/onlypreview/onlypreview.log` around the
   press before assuming the click was lost.
3. **`buildHost('standalone', …)`** — `destroyStandalone()` runs first, so if building the standalone
   window fails, the recovery path is the only thing that renders anything.

That ordering is the reason this symptom is invisible: the failure mode of this transition is
"returns to the previous host", which is indistinguishable from "the button did nothing".

## Reversal (2026-09-17)

Ral, 2026-09-17:「cowork bl 独立窗口打开 onlypreview 时,此时浏览器内的 onlypreview tab 应该显示一个
渲染进程:内容: 已在独立窗口打开,配上: 前往的按钮」,理由是「因为 onlypreview 会被设为首页,所以
关闭这个事情 UI 上不友好了,新的设计更好」。

The tab is no longer closed on undock. It stays and renders a placeholder. Design, edge cases and file
plan: [onlypreview-deferred-tab-placeholder](../features/onlypreview-deferred-tab-placeholder.md);
delivery: [task 181](../plan/tasks/onlypreview-deferred-tab-placeholder-181.md).

The original reasoning above is left intact because it is still the honest account of the code, and
because one of its own observations is what makes the reversal necessary. Symptom 2 called the
pinned/last-tab refusal "a latent edge" that "does not bite today". **It bites by default now.**
`onlyPreviewCoworkTab.ts:62` declares `defaultHome: true`, so on a machine that never set a homepage
the OnlyPreview composite *is* the pinned Home tab (see
[onlypreview-default-homepage.md](../features/onlypreview-default-homepage.md)), and `closeTab`
returns silently for a pinned tab (`maestroBrowserView.service.ts:2427`). So
「独立窗口打开,浏览器里的 tab 就得关掉」 has been unexecutable in the default configuration ever since
that default landed — the close was a no-op and the slot degraded to the built-in local Home instead.

What is **not** superseded, from the same 2026-09-07 session: the teardown-first ordering rule
(`onlyPreviewHostToggle.service.ts:248-262`) and the index-continuity rule
(`onlyPreviewWindow.helper.ts:231-238`). Both still hold.

Symptom 1 ("standalone does not take effect") is untouched by this reversal and its triage order above
still applies.
