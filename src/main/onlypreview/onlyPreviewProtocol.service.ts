import { protocol } from 'electron';
import { ONLY_PREVIEW_SCHEME } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewAssetRegistry } from './onlyPreviewAsset.registry';

let schemeRegistered = false;
let handlerInstalled = false;

export const registerOnlyPreviewScheme = (): void => {
  if (schemeRegistered) return;
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ONLY_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ]);
  schemeRegistered = true;
};

export const installOnlyPreviewProtocol = (): void => {
  if (handlerInstalled) return;
  protocol.handle(
    ONLY_PREVIEW_SCHEME,
    async (request) => await onlyPreviewAssetRegistry.respond(request)
  );
  handlerInstalled = true;
};

export const uninstallOnlyPreviewProtocol = (): void => {
  if (!handlerInstalled) return;
  protocol.unhandle(ONLY_PREVIEW_SCHEME);
  handlerInstalled = false;
};
