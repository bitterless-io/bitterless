import type { OnlyPreviewSearchBootstrap } from './onlyPreviewSearchBootstrap.types';

export const ONLY_PREVIEW_SEARCH_UTILITY_READY_MESSAGE = 'onlypreview-search-utility-ready';
export const ONLY_PREVIEW_SEARCH_UTILITY_REQUEST_MESSAGE = 'onlypreview-search-utility-request';
export const ONLY_PREVIEW_SEARCH_UTILITY_RESPONSE_MESSAGE = 'onlypreview-search-utility-response';
export const ONLY_PREVIEW_SEARCH_UTILITY_EVENT_MESSAGE = 'onlypreview-search-utility-event';

export interface OnlyPreviewSearchUtilityReadyMessage {
  type: typeof ONLY_PREVIEW_SEARCH_UTILITY_READY_MESSAGE;
  instanceId: string;
}

export type OnlyPreviewSearchUtilityMethod =
  | 'initialize'
  | 'refresh'
  | 'search'
  | 'cancel'
  | 'shutdown';

export interface OnlyPreviewSearchUtilityRequestMessage {
  type: typeof ONLY_PREVIEW_SEARCH_UTILITY_REQUEST_MESSAGE;
  requestId: string;
  method: OnlyPreviewSearchUtilityMethod;
  params: unknown;
  bootstrap?: OnlyPreviewSearchBootstrap;
}

export interface OnlyPreviewSearchUtilityResponseMessage {
  type: typeof ONLY_PREVIEW_SEARCH_UTILITY_RESPONSE_MESSAGE;
  requestId: string;
  result: unknown;
}

export interface OnlyPreviewSearchUtilityEventMessage {
  type: typeof ONLY_PREVIEW_SEARCH_UTILITY_EVENT_MESSAGE;
  eventName: string;
  value: unknown;
}
