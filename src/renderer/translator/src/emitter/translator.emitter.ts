import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import {
  MODEL_PROVIDER_SNAPSHOT_CHANGED_EVENT,
  type ModelProviderApi,
  type ModelProviderSnapshot
} from '@shared/modelProvider/modelProvider.contract';
import { parseModelProviderSnapshot } from '@shared/modelProvider/modelProvider.schema';
import type { TranslatorApi } from '@shared/translator/translator.contract';

export const modelProviderEmitter = createXpcRendererEmitter<ModelProviderApi>(
  'ModelProviderHandler'
) as ModelProviderApi;

export const translatorEmitter = createXpcRendererEmitter<TranslatorApi>(
  'TranslatorHandler'
) as TranslatorApi;

export const subscribeModelProviderSnapshots = (
  listener: (snapshot: ModelProviderSnapshot) => void
): void => {
  xpcRenderer.subscribe(MODEL_PROVIDER_SNAPSHOT_CHANGED_EVENT, (payload) => {
    listener(parseModelProviderSnapshot(payload.params));
  });
};
