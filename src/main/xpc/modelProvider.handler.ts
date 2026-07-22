import { XpcMainHandler } from 'electron-xpc/main';
import type {
  ModelProviderActionResult,
  ModelProviderApi,
  ModelProviderConnectInput,
  ModelProviderDisconnectInput,
  ModelProviderSnapshot
} from '@shared/modelProvider/modelProvider.contract';
import { modelProviderService } from '@main/modelProvider/modelProvider.runtime';

export class ModelProviderHandler extends XpcMainHandler implements ModelProviderApi {
  async getSnapshot(): Promise<ModelProviderSnapshot> {
    return await modelProviderService.getSnapshot();
  }

  async connect(params: ModelProviderConnectInput): Promise<ModelProviderActionResult> {
    return await modelProviderService.connect(params);
  }

  async disconnect(params: ModelProviderDisconnectInput): Promise<ModelProviderActionResult> {
    return await modelProviderService.disconnect(params);
  }
}

export const modelProviderHandler = new ModelProviderHandler();
