import { protocol, type Session } from 'electron';
import { ONLY_PREVIEW_SCHEME } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewAssetRegistry } from './onlyPreviewAsset.registry';
import { onlyPreviewDocumentRegistry } from './onlyPreviewDocument.registry';

let schemeRegistered = false;
let handlerInstalled = false;

/**
 * The Chrome preview session is shared across selections, so a late cleanup must never unhandle a
 * newer selection's handler. Each install claims a generation on its session; a cleanup only
 * unhandles while it still owns the current one.
 */
const sessionProtocolGenerations = new WeakMap<Session, number>();

const parseProtocolTarget = (requestUrl: string): { hostname: string; token: string } | null => {
  let url: URL;
  let hostname: string;
  try {
    url = new URL(requestUrl);
    hostname = url.hostname;
  } catch {
    return null;
  }
  const token = url.pathname.split('/')[1] || '';
  return /^[a-f0-9]{64}$/.test(token) ? { hostname, token } : null;
};

const respondToDefaultOnlyPreviewProtocol = async (request: Request): Promise<Response> => {
  const target = parseProtocolTarget(request.url);
  if (!target) return new Response(null, { status: 400 });
  if (target.hostname === 'asset') return await onlyPreviewAssetRegistry.respond(request);
  return new Response(null, { status: 404 });
};

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
  protocol.handle(ONLY_PREVIEW_SCHEME, respondToDefaultOnlyPreviewProtocol);
  handlerInstalled = true;
};

export const installOnlyPreviewSessionProtocol = (
  targetSession: Session,
  navigationUrl: string
): (() => void) => {
  const scope = parseProtocolTarget(navigationUrl);
  if (!scope || (scope.hostname !== 'asset' && scope.hostname !== 'document')) {
    throw new Error('OnlyPreview Chrome protocol scope is invalid.');
  }
  if (targetSession.protocol.isProtocolHandled(ONLY_PREVIEW_SCHEME)) {
    targetSession.protocol.unhandle(ONLY_PREVIEW_SCHEME);
  }
  const generation = (sessionProtocolGenerations.get(targetSession) ?? 0) + 1;
  sessionProtocolGenerations.set(targetSession, generation);
  targetSession.protocol.handle(ONLY_PREVIEW_SCHEME, async (request) => {
    const target = parseProtocolTarget(request.url);
    if (!target || target.hostname !== scope.hostname || target.token !== scope.token) {
      return new Response(null, { status: 404 });
    }
    return target.hostname === 'document'
      ? await onlyPreviewDocumentRegistry.respond(request)
      : await onlyPreviewAssetRegistry.respond(request);
  });
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    if (sessionProtocolGenerations.get(targetSession) !== generation) return;
    if (targetSession.protocol.isProtocolHandled(ONLY_PREVIEW_SCHEME)) {
      targetSession.protocol.unhandle(ONLY_PREVIEW_SCHEME);
    }
  };
};

export const uninstallOnlyPreviewProtocol = (): void => {
  if (!handlerInstalled) return;
  protocol.unhandle(ONLY_PREVIEW_SCHEME);
  handlerInstalled = false;
};
