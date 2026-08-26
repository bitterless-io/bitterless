import {
  ONLY_PREVIEW_SEARCH_MAX_RESULTS,
  type OnlyPreviewBrowseDirectoryRequest,
  type OnlyPreviewGlobalSearchPreviewRequest,
  type OnlyPreviewSearchCancelRequest,
  type OnlyPreviewSearchInitializeRequest,
  type OnlyPreviewSearchPrioritizeFileRequest,
  type OnlyPreviewSearchRequest,
  type OnlyPreviewSearchScope,
  type OnlyPreviewSearchShutdownRequest
} from './onlyPreviewSearch.type';
import { normalizeOnlyPreviewRelativePath, OnlyPreviewContractError } from './onlyPreview.contract';

const MAX_QUERY_CODE_UNITS = 16_384;

const expectRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const expectToken = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} is invalid.`);
  }
  return value;
};

const expectGeneration = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Search generation is invalid.');
  }
  return value as number;
};

const expectExactKeys = (
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string
): void => {
  const actualKeys = Object.keys(record).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} has an invalid field.`);
  }
};

export const parseOnlyPreviewSearchScope = (value: unknown): OnlyPreviewSearchScope => {
  const record = expectRecord(value, 'Search scope');
  if (record.kind === 'project') {
    expectExactKeys(record, ['kind'], 'Project search scope');
    return { kind: 'project' };
  }
  if (record.kind === 'directory') {
    expectExactKeys(record, ['kind', 'relativePath'], 'Directory search scope');
    return {
      kind: 'directory',
      relativePath: normalizeOnlyPreviewRelativePath(record.relativePath, { allowEmpty: true })
    };
  }
  throw new OnlyPreviewContractError('INVALID_INPUT', 'Search scope kind is invalid.');
};

export const parseOnlyPreviewSearchInitializeRequest = (
  value: unknown
): OnlyPreviewSearchInitializeRequest => {
  const record = expectRecord(value, 'Search initialize request');
  expectExactKeys(record, ['generation', 'hostToken', 'workspaceId'], 'Search initialize request');
  return {
    hostToken: expectToken(record.hostToken, 'Host capability'),
    workspaceId: expectToken(record.workspaceId, 'Workspace capability'),
    generation: expectGeneration(record.generation)
  };
};

export const parseOnlyPreviewBrowseDirectoryRequest = (
  value: unknown
): OnlyPreviewBrowseDirectoryRequest => {
  const record = expectRecord(value, 'Browse directory request');
  expectExactKeys(
    record,
    ['directoryToken', 'generation', 'hostToken', 'workspaceId'],
    'Browse directory request'
  );
  return {
    hostToken: expectToken(record.hostToken, 'Host capability'),
    workspaceId: expectToken(record.workspaceId, 'Workspace capability'),
    generation: expectGeneration(record.generation),
    directoryToken: expectToken(record.directoryToken, 'Directory capability')
  };
};

export const parseOnlyPreviewSearchPrioritizeFileRequest = (
  value: unknown
): OnlyPreviewSearchPrioritizeFileRequest => {
  const record = expectRecord(value, 'Search priority request');
  expectExactKeys(
    record,
    ['generation', 'hostToken', 'relativePath', 'workspaceId'],
    'Search priority request'
  );
  return {
    hostToken: expectToken(record.hostToken, 'Host capability'),
    workspaceId: expectToken(record.workspaceId, 'Workspace capability'),
    generation: expectGeneration(record.generation),
    relativePath: normalizeOnlyPreviewRelativePath(record.relativePath)
  };
};

export const parseOnlyPreviewSearchRequest = (value: unknown): OnlyPreviewSearchRequest => {
  const record = expectRecord(value, 'Search request');
  expectExactKeys(
    record,
    ['generation', 'hostToken', 'maxResults', 'query', 'requestId', 'scope', 'workspaceId'],
    'Search request'
  );
  if (typeof record.query !== 'string' || record.query.length > MAX_QUERY_CODE_UNITS) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Search query is invalid.');
  }
  if (
    !Number.isInteger(record.maxResults) ||
    (record.maxResults as number) < 0 ||
    (record.maxResults as number) > ONLY_PREVIEW_SEARCH_MAX_RESULTS
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Search result limit is invalid.');
  }
  return {
    hostToken: expectToken(record.hostToken, 'Host capability'),
    workspaceId: expectToken(record.workspaceId, 'Workspace capability'),
    generation: expectGeneration(record.generation),
    requestId: expectToken(record.requestId, 'Search request ID'),
    query: record.query,
    maxResults: record.maxResults as number,
    scope: parseOnlyPreviewSearchScope(record.scope)
  };
};

export const parseOnlyPreviewSearchCancelRequest = (
  value: unknown
): OnlyPreviewSearchCancelRequest => {
  const record = expectRecord(value, 'Search cancel request');
  expectExactKeys(record, ['hostToken', 'requestId'], 'Search cancel request');
  return {
    hostToken: expectToken(record.hostToken, 'Host capability'),
    requestId: expectToken(record.requestId, 'Search request ID')
  };
};

export const parseOnlyPreviewGlobalSearchPreviewRequest = (
  value: unknown
): OnlyPreviewGlobalSearchPreviewRequest => {
  const record = expectRecord(value, 'Global search preview request');
  expectExactKeys(
    record,
    ['generation', 'hostToken', 'requestId', 'resultToken', 'workspaceId'],
    'Global search preview request'
  );
  return {
    hostToken: expectToken(record.hostToken, 'Host capability'),
    workspaceId: expectToken(record.workspaceId, 'Workspace capability'),
    generation: expectGeneration(record.generation),
    requestId: expectToken(record.requestId, 'Search request ID'),
    resultToken: expectToken(record.resultToken, 'Search result capability')
  };
};

export const parseOnlyPreviewSearchShutdownRequest = (
  value: unknown
): OnlyPreviewSearchShutdownRequest => {
  const record = expectRecord(value, 'Search shutdown request');
  expectExactKeys(record, ['hostToken'], 'Search shutdown request');
  return { hostToken: expectToken(record.hostToken, 'Host capability') };
};
