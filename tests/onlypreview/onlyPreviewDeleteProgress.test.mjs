/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test, { describe } from 'node:test';

/**
 * The delete progress dialog — docs/features/onlypreview-delete-progress.md.
 *
 * Source-shape assertions, like the rest of the alert-layer guards: the run this describes needs a
 * live window and a real recursive removal, so what is checkable here is that the contract holds —
 * the delay gate exists, the dialog is closed from a `finally`, and it cannot be resolved.
 */
const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const DELETE = 'src/main/onlypreview/onlyPreviewDeleteDialog.service.ts';
const VIEW = 'src/main/onlypreview/views/onlyPreviewAlertView.service.ts';
const TYPES = 'src/shared/onlypreview/onlyPreviewAlert.types.ts';
const CONTRACT = 'src/shared/onlypreview/onlyPreviewAlert.contract.ts';
const COMPONENT = 'src/renderer/onlypreview/alert/src/components/AlertProgress/AlertProgress.vue';

describe('GDP2 — a fast delete shows nothing', () => {
  test('the dialog is opened on a timer, not on the first entry', () => {
    const delete_ = source(DELETE);
    assert.match(delete_, /ONLY_PREVIEW_DELETE_PROGRESS_DELAY_MS\s*=\s*\d+/);
    assert.match(delete_, /setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?showProgress\(/);
  });

  test('the timer is opened AFTER the confirmation, so the one dialog slot is never contended', () => {
    const delete_ = source(DELETE);
    assert.ok(
      delete_.indexOf('requestConfirm(') < delete_.indexOf('setTimeout('),
      'confirm first, then progress'
    );
  });
});

describe('GDP4 — it closes when the work ends', () => {
  test('a `finally` closes it, so a throw from the executor cannot strand it', () => {
    const delete_ = source(DELETE);
    assert.match(delete_, /\}\s*finally\s*\{[\s\S]*?settleProgress\(\)/);
  });

  test('settleProgress clears the timer as well as closing the dialog', () => {
    const delete_ = source(DELETE);
    const fn = delete_.slice(
      delete_.indexOf('const settleProgress'),
      delete_.indexOf('const settleProgress') + 260
    );
    assert.match(fn, /clearTimeout\(progressTimer\)/, 'a run that ends inside the delay must not open one');
    assert.match(fn, /closeProgress\(progressId\)/);
  });

  test('a failure closes the progress BEFORE the error, so they never stack', () => {
    const delete_ = source(DELETE);
    // Indentation-agnostic: prettier owns the whitespace, the ORDER is what this guards.
    assert.match(
      delete_,
      /settleProgress\(\);\s*await onlyPreviewAlertWindowService\s*\.showError\(/,
      'the failure path closes progress before it reports'
    );
  });
});

describe('GDP3 — it cannot be dismissed', () => {
  test('the service refuses to resolve a progress dialog', () => {
    const view = source(VIEW);
    assert.match(
      view,
      /this\.dialog\?\.kind === 'progress'[\s\S]{0,200}?Alert progress cannot be resolved/,
      'refusing in the service, not just omitting buttons in the renderer'
    );
  });

  test('the refusal runs before the pending-dialog lookup, which would otherwise throw first', () => {
    const view = source(VIEW);
    const refusal = view.indexOf('Alert progress cannot be resolved');
    const pending = view.indexOf("this.pendingDialog?.dialogId !== resolution.dialogId");
    assert.ok(refusal > 0 && pending > 0 && refusal < pending);
  });

  test('the dialog type carries no button labels — there is nothing to press', () => {
    const types = source(TYPES);
    const block = types.slice(
      types.indexOf('export interface OnlyPreviewAlertProgressDialog'),
      types.indexOf('export type OnlyPreviewAlertDialog')
    );
    assert.equal(block.includes('confirmLabel'), false);
    assert.equal(block.includes('cancelLabel'), false);
  });

  test('the component renders no button', () => {
    assert.equal(source(COMPONENT).includes('<button'), false);
  });

  test('a progress dialog blocks another dialog from replacing it silently', () => {
    const view = source(VIEW);
    assert.match(view, /if \(this\.pendingDialog \|\| this\.dialog\?\.kind === 'progress'\)/);
  });
});

describe('GDP5 — it never claims progress it cannot see', () => {
  test('a single-entry run gets no count label at all', () => {
    const view = source(VIEW);
    assert.match(view, /const fillProgressCount[\s\S]{0,220}?total > 1 \?/);
  });

  test('the component picks indeterminate from total, not from a percentage Main sent', () => {
    const component = source(COMPONENT);
    assert.match(component, /determinate = computed\(\(\) => \(dialog\.value\?\.total \?\? 0\) > 1\)/);
    assert.match(component, /onlypreview-alert-progress__fill--indeterminate/);
  });

  test('Main never sends a percentage — only completed and total', () => {
    const types = source(TYPES);
    const block = types.slice(
      types.indexOf('export interface OnlyPreviewAlertProgressDialog'),
      types.indexOf('export type OnlyPreviewAlertDialog')
    );
    assert.equal(/percent|ratio/i.test(block), false);
  });
});

describe('the wire contract', () => {
  test('the snapshot parser accepts the new kind — otherwise the renderer throws on every frame', () => {
    const contract = source(CONTRACT);
    assert.match(contract, /dialogRecord\.kind === 'progress'\) dialog = parseProgressDialog/);
  });

  test('a count past its total is refused rather than drawn over 100%', () => {
    assert.match(source(CONTRACT), /completed > total[\s\S]{0,160}?exceeds its total/);
  });

  test('the count label is filled by Main — the alert renderer owns no wording', () => {
    const types = source(TYPES);
    assert.match(types, /countLabel: string;/);
    assert.equal(source(COMPONENT).includes('onlyPreviewI18n'), false);
  });

  test('both locales carry every new label', () => {
    for (const locale of ['en', 'zh']) {
      const catalog = source(`src/renderer/common/i18n/${locale}.ts`);
      for (const key of ['deleteProgressTitle', 'deleteProgressMessage', 'deleteProgressCount']) {
        assert.ok(catalog.includes(`${key}:`), `${locale} is missing ${key}`);
      }
    }
  });

  test('cloneDialog no longer assumes every non-new-folder dialog has entries', () => {
    const view = source(VIEW);
    assert.match(view, /if \(dialog\.kind !== 'confirm'\) return \{ \.\.\.dialog \};/);
  });
});
