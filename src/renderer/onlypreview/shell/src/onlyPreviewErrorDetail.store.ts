import { reactive } from 'vue';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import {
  describeOnlyPreviewErrorDetail,
  formatOnlyPreviewErrorDetail,
  isEmptyOnlyPreviewErrorDetail,
  type OnlyPreviewErrorDetail
} from './onlyPreviewErrorDetail.service';

/**
 * The detail behind the Project rail's error banner.
 *
 * The banner shows one localized sentence, which is what the owner should read and useless for
 * reporting: a renderer `ReferenceError` and a refused workspace both render as "could not complete
 * this action". This keeps the raw error beside it so it can be copied verbatim.
 */
class OnlyPreviewErrorDetailStore {
  detail: OnlyPreviewErrorDetail | null = null;
  // The wall-clock the error was captured at, so a copied report can be lined up with the log.
  at = '';
  copied = false;

  get available(): boolean {
    return !isEmptyOnlyPreviewErrorDetail(this.detail);
  }

  get text(): string {
    return this.detail ? formatOnlyPreviewErrorDetail(this.detail, this.at) : '';
  }

  record(error: unknown, at: string): void {
    this.detail = describeOnlyPreviewErrorDetail(error);
    this.at = at;
    this.copied = false;
  }

  clear(): void {
    this.detail = null;
    this.at = '';
    this.copied = false;
  }

  async copy(): Promise<void> {
    const text = this.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copied = true;
      return;
    } catch {
      // Async clipboard access can be refused; the selection fallback below still works from a
      // click, and it keeps this off the Main clipboard path, which is reserved for Project items.
    }
    this.copied = copyThroughSelection(text);
  }
}

// The last-resort copy: a hidden textarea and `execCommand`, which needs no permission at all.
const copyThroughSelection = (text: string): boolean => {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
};

export const onlyPreviewErrorDetail = reactive(new OnlyPreviewErrorDetailStore());

/**
 * The shell's error-to-banner mapper, and the one place every banner message passes through.
 *
 * Capturing here rather than at each `catch` keeps the call sites unchanged and means no path can
 * show a banner without its detail.
 */
export const describeOnlyPreviewError = (error: unknown): string => {
  onlyPreviewErrorDetail.record(error, new Date().toISOString());
  return error instanceof OnlyPreviewContractError
    ? getOnlyPreviewErrorMessage(error.code)
    : onlyPreviewI18n.errors.OPERATION_FAILED;
};
