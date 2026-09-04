# OnlyPreview — a delete says it is working

Owner request (2026-09-04):

> 如果涉及到大的目录删除需要花时间的，你可以 globalalertview 上显示 删除中的进度
> 且等删除完了才不显示，且不能取消显示

Sibling: [`onlypreview-alert-dialogs.md`](./onlypreview-alert-dialogs.md) (the layer this lives in) ·
[`issues/onlypreview-delete-refreshes-the-wrong-index.md`](../issues/onlypreview-delete-refreshes-the-wrong-index.md)
(why the rows used to linger — a different cause, fixed separately).

Status: designed + implemented 2026-09-04 · Ral + Claude

---

## Glossary — code prefixes

**`DP`**: `GDP<n>` goal · `DDP<n>` decision · `RDP<n>` risk.

---

## #0 · What this is for

The delete run is `for (const entry of plan.entries) await executor.removeEntry(entry)`. A recursive
folder removal inside one of those iterations can take seconds, and until it returns nothing at all
happens on screen — the announcement that drops the rows is only sent once the whole run finishes.

| ID | goal | test |
| --- | --- | --- |
| **GDP1** | a slow delete says it is working | the dialog is on screen while the run is in flight |
| **GDP2** | a fast delete does not flash | nothing is shown for a run that finishes quickly |
| **GDP3** | it cannot be dismissed | no buttons, no Escape, and `resolve()` refuses its id |
| **GDP4** | it closes when the work ends | closed on success, on failure, and on a thrown run |
| **GDP5** | it never claims progress it cannot see | a single-entry run is indeterminate, not `1/1` |

---

## #1 · The progress number is only honest when there is more than one entry {#s1}

**RDP1 · A percentage over a recursive removal would be invented.**

Progress is counted in **selection entries**, because that is the only unit the run actually steps
through. Deleting one big folder is one entry: `0/1` then `1/1`. A bar drawn from that would sit at
zero for the whole wait and then jump — it would be describing the loop, not the work.

**DDP1 · Two presentations, chosen by `total`.**

| run | shown |
| --- | --- |
| `total > 1` | a determinate bar plus `completed / total` — the loop really is stepping |
| `total === 1` | an indeterminate bar, no numbers — we cannot see inside the recursion |

The dialog carries `completed` and `total` and the renderer decides. Main never sends a percentage.

---

## #2 · Nothing is shown for a fast delete {#s2}

**DDP2 · The dialog opens on a timer, not on the first entry.**

`ONLY_PREVIEW_DELETE_PROGRESS_DELAY_MS = 250`. A delete that finishes inside that window never
opens a dialog at all, so the ordinary case — one file, gone instantly — looks exactly as it does
today. A dialog that appears and disappears within a frame reads as a glitch, not as feedback.

The timer is cleared in the same `finally` that closes the dialog, so a run that throws cannot leave
a dialog scheduled to open after it is over.

---

## #3 · It is not dismissible, which makes it a different kind of dialog {#s3}

**DDP3 · `progress` has no `confirmLabel` and no `cancelLabel`, and `resolve()` refuses it.**

Every other dialog in this layer exists to collect an answer, so the resolution path assumes a
`pendingDialog` with a `settle`. A progress dialog has no answer to give: Main opens it, Main
updates it, Main closes it. Making it merely *look* unclickable would leave Escape and the renderer's
resolve call able to close it, so the refusal is in the service:

```ts
if (this.dialog?.kind === 'progress') {
  throw new OnlyPreviewContractError('INVALID_INPUT', 'Alert progress cannot be resolved.');
}
```

**RDP2 · A dialog nobody can close is a hang if it is ever leaked.** The only writer is
`presentOnlyPreviewDeleteDialog`, which closes it in a `finally`, and `destroy()` clears it with the
rest of the stack. There is deliberately no public "close any progress" — one owner, one lifetime.

---

## #4 · Where it sits in the run {#s4}

```
collapse selection
  → confirm dialog                (answered, then closed — the slot is free again)
  → schedule progress in 250ms
  → for each entry: remove, then update completed
  → finally: cancel the timer, close the progress dialog
  → error dialog if the run stopped early   (stacked above; progress is already gone)
```

The progress dialog is opened **after** the confirmation is answered, so the single dialog slot is
never contended.

---

## #5 · Changes

| file | change |
| --- | --- |
| `src/shared/onlypreview/onlyPreviewAlert.types.ts` | `OnlyPreviewAlertProgressDialog`, added to the dialog union + the request type |
| `src/shared/onlypreview/onlyPreviewAlert.contract.ts` | `parseProgressDialog`, wired into the snapshot parser |
| `src/main/onlypreview/views/onlyPreviewAlertView.service.ts` | `showProgress` / `updateProgress` / `closeProgress`; `resolve()` refuses a progress id |
| `src/main/onlypreview/views/onlyPreviewAlertWindow.service.ts` | the three pass-throughs |
| `src/main/onlypreview/onlyPreviewDeleteDialog.service.ts` | the timer, the per-entry update, the `finally` |
| `src/renderer/onlypreview/alert/src/onlyPreviewAlert.store.ts` | `progressDialog` getter |
| `src/renderer/onlypreview/alert/src/components/AlertProgress/` | the view |
| `src/renderer/common/i18n/{en,zh}.ts` | `deleteProgressTitle` / `deleteProgressMessage` / `deleteProgressCount` |

## #6 · Verification

`tests/onlypreview/onlyPreviewDeleteProgress.test.mjs` — the delay gate (a fast run opens nothing),
the close on success / failure / throw, the refusal to resolve, and `total === 1` staying
indeterminate. **No E2E** (root CLAUDE.md).
