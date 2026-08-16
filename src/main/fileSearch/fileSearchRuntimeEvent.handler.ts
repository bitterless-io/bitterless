import { XpcMainHandler } from 'electron-xpc/main';
import type {
  FileSearchRuntimeEventApi,
  FileSearchRuntimeEventRequest
} from '@shared/onlypreview/fileSearchRuntime.types';
import { fileSearchRuntimeEventHandlerName } from '@shared/onlypreview/fileSearchRuntime.types';
import { fileSearchRuntimeRelayService } from './fileSearchRuntimeRelay.service';

export const registerFileSearchRuntimeEventHandler = (
  capability: string
): FileSearchRuntimeEventApi => {
  class CapabilityBoundFileSearchRuntimeEventHandler
    extends XpcMainHandler
    implements FileSearchRuntimeEventApi
  {
    async publish(params: FileSearchRuntimeEventRequest): Promise<{ ok: true }> {
      return fileSearchRuntimeRelayService.publish(params);
    }
  }

  Object.defineProperty(CapabilityBoundFileSearchRuntimeEventHandler, 'name', {
    value: fileSearchRuntimeEventHandlerName(capability)
  });
  return new CapabilityBoundFileSearchRuntimeEventHandler();
};
