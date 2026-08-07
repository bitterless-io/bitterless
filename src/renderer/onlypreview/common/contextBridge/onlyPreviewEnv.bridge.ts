import type { OnlyPreviewEnvApi } from '@preload/onlypreview/onlypreview.preload.type';

interface OnlyPreviewEnvWindow {
  readonly onlyPreviewEnv: OnlyPreviewEnvApi;
}

export const onlyPreviewEnv = (window as unknown as OnlyPreviewEnvWindow).onlyPreviewEnv;
