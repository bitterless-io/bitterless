import { resolve } from 'node:path';
import {
  OnlyPreviewContractError,
  parseOnlyPreviewPreviewRevisionRequest
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewApi } from '@shared/onlypreview/onlyPreview.types';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';
import {
  onlyPreviewRecentsService,
  recordOnlyPreviewRecentFile
} from './onlyPreviewRecents.runtime';
import {
  onlyPreviewTargetMutations,
  presentOnlyPreviewExplicitFile,
  openOnlyPreviewAbsoluteTargetInMutation
} from './onlyPreviewExplicitOpen.service';
import { resolveOnlyPreviewPreviewRegion } from './views/onlyPreviewPreviewRegion.service';
import { resolveOnlyPreviewTargetScope } from './onlyPreviewWorkspaceScope.service';
import { resolveOnlyPreviewMarkdownLink } from './onlyPreviewMarkdownLink.service';

type Params<T extends keyof OnlyPreviewApi> = Parameters<OnlyPreviewApi[T]>[0];

const openFile = async (
  hostToken: string,
  path: string,
  promote: boolean,
  validate: () => void,
  fragment?: string
): Promise<void> => {
  const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
  const inspected = await fileSearchWindowService.inspectTarget(path);
  onlyPreviewHostRegistry.require(hostToken, ['content']);
  validate();
  if (!inspected.selectedRelativePath) {
    throw new OnlyPreviewContractError(
      'PATH_NOT_REGULAR_FILE',
      'Recent and Markdown targets must be files.'
    );
  }
  const scope = await resolveOnlyPreviewTargetScope(inspected);
  if (scope.kind === 'outside' || !onlyPreviewWorkspaceRegistry.restore(hostToken)) {
    await openOnlyPreviewAbsoluteTargetInMutation(path, { fragment });
    return;
  }
  const accepted = await presentOnlyPreviewExplicitFile(host, inspected, undefined, fragment);
  if (accepted && promote) {
    await recordOnlyPreviewRecentFile(
      hostToken,
      resolve(inspected.rootRealPath, inspected.selectedRelativePath)
    );
  }
};

const projectFence = (hostToken: string): (() => void) => {
  const projectId = onlyPreviewWorkspaceRegistry.restore(hostToken)?.workspaceId;
  return () => {
    onlyPreviewHostRegistry.require(hostToken, ['content']);
    if (onlyPreviewWorkspaceRegistry.restore(hostToken)?.workspaceId !== projectId) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'The active Project changed before opening this file.'
      );
    }
  };
};

export const openOnlyPreviewRecent = async (params: Params<'openRecent'>): Promise<void> => {
  const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
  await onlyPreviewTargetMutations.run(async () => {
    const path = await onlyPreviewRecentsService.resolveEntry(
      host.hostToken,
      params.entryId,
      params.revision
    );
    await openFile(host.hostToken, path, false, projectFence(host.hostToken));
  });
};

export const navigateOnlyPreviewRecent = async (
  params: Params<'navigateRecent'>
): Promise<void> => {
  const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
  await onlyPreviewTargetMutations.run(async () => {
    const path = await onlyPreviewRecentsService.navigate(
      host.hostToken,
      params.direction,
      params.revision
    );
    if (path) await openFile(host.hostToken, path, false, projectFence(host.hostToken));
  });
};

export const reloadOnlyPreview = async (params: Params<'reloadPreview'>): Promise<void> => {
  const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
  await onlyPreviewTargetMutations.run(async () => {
    onlyPreviewHostRegistry.require(host.hostToken, ['content']);
    await resolveOnlyPreviewPreviewRegion(host.hostToken).refresh(host.hostToken);
  });
};

export const openOnlyPreviewMarkdownLink = async (
  params: Params<'openMarkdownLink'>
): Promise<void> => {
  const request = parseOnlyPreviewPreviewRevisionRequest(params);
  const requireSource = (): string => {
    const source = resolveOnlyPreviewPreviewRegion(request.hostToken).snapshotForVue(
      request.hostToken,
      request.previewRuntimeToken
    );
    if (
      source.selectionRevision !== request.selectionRevision ||
      source.adapterId !== 'markdown-dom' ||
      !source.fileRef
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Markdown link belongs to a stale preview.'
      );
    }
    const authority = onlyPreviewWorkspaceRegistry.getPreviewAuthorityItemRef(
      request.hostToken,
      source.fileRef
    );
    return resolve(authority.rootPath, authority.relativePath);
  };
  requireSource();
  await onlyPreviewTargetMutations.run(async () => {
    const source = requireSource();
    const target = resolveOnlyPreviewMarkdownLink(source, params.href);
    if (target.path === source) {
      resolveOnlyPreviewPreviewRegion(request.hostToken).navigateFragment(
        request.hostToken,
        request.previewRuntimeToken,
        request.selectionRevision,
        target.fragment ?? ''
      );
      return;
    }
    await openFile(
      request.hostToken,
      target.path,
      true,
      () => {
        requireSource();
      },
      target.fragment
    );
  });
};
