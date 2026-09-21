import {
  ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_MAX_DIRECTORY_ENTRIES,
  ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_MAX_TEXT_BYTES,
  ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS
} from '@shared/onlypreview/onlyPreviewSearch.type';
import {
  ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES,
  ONLY_PREVIEW_OFFICE_READ_MAX_BYTES
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';

interface SearchExpectation {
  workspaceId: string | null;
  generation: number | null;
  requestId: string | null;
  maxResults?: number | null;
  resultToken?: string | null;
  readGrant?: string | null;
  offset?: number | null;
}

const MEDIA_TYPES = new Set(['text', 'image', 'audio', 'video', 'pdf', 'unknown']);
const PREVIEW_HINTS = new Set([
  'text',
  'pdf',
  'image',
  'audio',
  'video',
  'sheet',
  'document',
  'presentation',
  'diagram',
  'unsupported'
]);
const NODE_KINDS = new Set(['file', 'directory', 'symlink']);
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  );
};

const boundedString = (value: unknown, maximum = 16_384): value is string =>
  typeof value === 'string' && value.length <= maximum && !value.includes('\0');

const boundedToken = (value: unknown): value is string =>
  boundedString(value, 256) && value.length > 0;

const relativePath = (value: unknown, allowEmpty = false): value is string => {
  if (!boundedString(value) || (!allowEmpty && !value)) return false;
  if (value.startsWith('/') || value.includes('\\') || /^[a-zA-Z]:/u.test(value)) return false;
  if (!value) return allowEmpty;
  return !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');
};

const parentOf = (value: string): string =>
  value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : '';

const basenameOf = (value: string): string => value.slice(value.lastIndexOf('/') + 1);

const contentMatch = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['highlightLength', 'highlightStart', 'snippetText']) ||
    !boundedString(value.snippetText, 65_536) ||
    !Number.isSafeInteger(value.highlightStart) ||
    (value.highlightStart as number) < 0 ||
    !Number.isSafeInteger(value.highlightLength) ||
    (value.highlightLength as number) < 1
  ) {
    return false;
  }
  const length = [...segmenter.segment(value.snippetText)].length;
  return (value.highlightStart as number) + (value.highlightLength as number) <= length;
};

const fileResult = (
  value: unknown
): value is Record<string, unknown> & { relativePath: string } => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'mediaType',
      'name',
      'nodeKind',
      'parentRelativePath',
      'previewHint',
      'relativePath',
      'resultToken',
      'section'
    ]) ||
    value.section !== 'files' ||
    !boundedToken(value.resultToken) ||
    !relativePath(value.relativePath) ||
    !relativePath(value.parentRelativePath, true) ||
    value.parentRelativePath !== parentOf(value.relativePath) ||
    !boundedString(value.name, 4_096) ||
    value.name !== basenameOf(value.relativePath) ||
    (value.nodeKind !== 'file' && value.nodeKind !== 'directory') ||
    !PREVIEW_HINTS.has(String(value.previewHint)) ||
    !MEDIA_TYPES.has(String(value.mediaType))
  ) {
    return false;
  }
  return (
    (value.nodeKind === 'directory' &&
      value.previewHint === 'unsupported' &&
      value.mediaType === 'unknown') ||
    value.nodeKind === 'file'
  );
};

const contentResult = (
  value: unknown
): value is Record<string, unknown> & { relativePath: string } =>
  isRecord(value) &&
  exactKeys(value, [
    'contentMatch',
    'fileName',
    'mediaType',
    'parentRelativePath',
    'relativePath',
    'resultToken',
    'section'
  ]) &&
  value.section === 'contents' &&
  boundedToken(value.resultToken) &&
  relativePath(value.relativePath) &&
  relativePath(value.parentRelativePath, true) &&
  value.parentRelativePath === parentOf(value.relativePath) &&
  boundedString(value.fileName, 4_096) &&
  value.fileName === basenameOf(value.relativePath) &&
  value.mediaType === 'text' &&
  contentMatch(value.contentMatch);

const resultArray = (
  value: unknown,
  maximum: number,
  validate: (candidate: unknown) => candidate is Record<string, unknown> & { relativePath: string }
): boolean => {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    return false;
  }
  const paths = new Set<string>();
  const tokens = new Set<string>();
  return value.every((candidate) => {
    if (!validate(candidate) || paths.has(candidate.relativePath)) return false;
    const token = candidate.resultToken as string;
    if (tokens.has(token)) return false;
    paths.add(candidate.relativePath);
    tokens.add(token);
    return true;
  });
};

const commonEnvelope = (value: Record<string, unknown>, expectation: SearchExpectation): boolean =>
  value.workspaceId === expectation.workspaceId &&
  value.generation === expectation.generation &&
  value.requestId === expectation.requestId;

export const isOnlyPreviewGlobalSearchResponse = (
  value: unknown,
  expectation: SearchExpectation
): boolean => {
  const sectionMaximum = Math.min(
    ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS,
    expectation.maxResults ?? ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS
  );
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'contents',
      'contentsTruncated',
      'files',
      'filesTruncated',
      'generation',
      'requestId',
      'workspaceId'
    ]) ||
    !commonEnvelope(value, expectation) ||
    typeof value.filesTruncated !== 'boolean' ||
    typeof value.contentsTruncated !== 'boolean' ||
    !resultArray(value.files, sectionMaximum, fileResult) ||
    !resultArray(value.contents, sectionMaximum, contentResult)
  ) {
    return false;
  }
  const tokens = [
    ...(value.files as Record<string, unknown>[]),
    ...(value.contents as Record<string, unknown>[])
  ].map((result) => result.resultToken);
  return new Set(tokens).size === tokens.length;
};

export const isOnlyPreviewGlobalSearchBatch = (
  value: unknown,
  expectation: SearchExpectation,
  maximum: number
): boolean =>
  isRecord(value) &&
  exactKeys(value, ['contents', 'files', 'generation', 'requestId', 'workspaceId']) &&
  commonEnvelope(value, expectation) &&
  resultArray(value.files, maximum, fileResult) &&
  resultArray(value.contents, maximum, contentResult) &&
  (value.files as unknown[]).length + (value.contents as unknown[]).length <= maximum;

const browseEntry = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'directoryToken',
      'isText',
      'mediaType',
      'modifiedAt',
      'name',
      'nodeKind',
      'parentRelativePath',
      'previewHint',
      'relativePath',
      'size'
    ]) ||
    !relativePath(value.relativePath) ||
    !relativePath(value.parentRelativePath, true) ||
    value.parentRelativePath !== parentOf(value.relativePath) ||
    !boundedString(value.name, 4_096) ||
    value.name !== basenameOf(value.relativePath) ||
    !NODE_KINDS.has(String(value.nodeKind)) ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    !Number.isSafeInteger(value.modifiedAt) ||
    (value.modifiedAt as number) < 0 ||
    !PREVIEW_HINTS.has(String(value.previewHint)) ||
    !MEDIA_TYPES.has(String(value.mediaType)) ||
    typeof value.isText !== 'boolean'
  ) {
    return false;
  }
  return value.directoryToken === null;
};

export const isOnlyPreviewGlobalSearchPreview = (
  value: unknown,
  expectation?: SearchExpectation
): boolean => {
  if (!isRecord(value) || !boundedString(value.name, 4_096)) return false;
  if (value.kind === 'text') {
    return (
      exactKeys(value, ['adapter', 'kind', 'name', 'text', 'truncated']) &&
      (value.adapter === 'plain' ||
        value.adapter === 'markdown' ||
        value.adapter === 'html-static') &&
      boundedString(value.text, ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_MAX_TEXT_BYTES) &&
      typeof value.truncated === 'boolean'
    );
  }
  if (value.kind === 'directory') {
    return (
      exactKeys(value, ['entries', 'kind', 'name', 'truncated']) &&
      Array.isArray(value.entries) &&
      value.entries.length <= ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_MAX_DIRECTORY_ENTRIES &&
      Reflect.ownKeys(value.entries).length === value.entries.length + 1 &&
      value.entries.every(browseEntry) &&
      typeof value.truncated === 'boolean'
    );
  }
  if (value.kind === 'office') {
    const adapterExtensions = {
      xlsx: new Set(['.xlsx', '.xlsm']),
      docx: new Set(['.docx']),
      pptx: new Set(['.pptx'])
    } as const;
    return (
      exactKeys(value, [
        'adapter',
        'generation',
        'kind',
        'modifiedAt',
        'name',
        'readGrant',
        'requestId',
        'resultToken',
        'size',
        'sourceExtension',
        'workspaceId'
      ]) &&
      (value.adapter === 'xlsx' || value.adapter === 'docx' || value.adapter === 'pptx') &&
      adapterExtensions[value.adapter].has(value.sourceExtension as never) &&
      boundedToken(value.workspaceId) &&
      Number.isSafeInteger(value.generation) &&
      (value.generation as number) >= 0 &&
      boundedToken(value.requestId) &&
      boundedToken(value.resultToken) &&
      boundedToken(value.readGrant) &&
      Number.isSafeInteger(value.size) &&
      (value.size as number) >= 0 &&
      (value.size as number) <= ONLY_PREVIEW_OFFICE_READ_MAX_BYTES &&
      Number.isSafeInteger(value.modifiedAt) &&
      (value.modifiedAt as number) >= 0 &&
      (!expectation ||
        (value.workspaceId === expectation.workspaceId &&
          value.generation === expectation.generation &&
          value.requestId === expectation.requestId &&
          value.resultToken === expectation.resultToken))
    );
  }
  return (
    value.kind === 'info' &&
    exactKeys(value, ['kind', 'mediaType', 'modifiedAt', 'name', 'previewHint', 'size']) &&
    PREVIEW_HINTS.has(String(value.previewHint)) &&
    MEDIA_TYPES.has(String(value.mediaType)) &&
    Number.isSafeInteger(value.size) &&
    (value.size as number) >= 0 &&
    Number.isSafeInteger(value.modifiedAt) &&
    (value.modifiedAt as number) >= 0
  );
};

const officeReadEnvelope = (
  value: Record<string, unknown>,
  expectation: SearchExpectation
): boolean =>
  value.workspaceId === expectation.workspaceId &&
  value.generation === expectation.generation &&
  value.requestId === expectation.requestId &&
  value.resultToken === expectation.resultToken &&
  value.readGrant === expectation.readGrant;

export const isOnlyPreviewGlobalSearchOfficeReadOpenResult = (
  value: unknown,
  expectation: SearchExpectation
): boolean =>
  isRecord(value) &&
  exactKeys(value, [
    'generation',
    'readGrant',
    'requestId',
    'resultToken',
    'totalBytes',
    'workspaceId'
  ]) &&
  officeReadEnvelope(value, expectation) &&
  Number.isSafeInteger(value.totalBytes) &&
  (value.totalBytes as number) >= 0 &&
  (value.totalBytes as number) <= ONLY_PREVIEW_OFFICE_READ_MAX_BYTES;

export const isOnlyPreviewGlobalSearchOfficeReadChunkResult = (
  value: unknown,
  expectation: SearchExpectation
): boolean =>
  isRecord(value) &&
  exactKeys(value, [
    'bytes',
    'eof',
    'generation',
    'offset',
    'readGrant',
    'requestId',
    'resultToken',
    'workspaceId'
  ]) &&
  officeReadEnvelope(value, expectation) &&
  value.offset === expectation.offset &&
  value.bytes instanceof ArrayBuffer &&
  value.bytes.byteLength <= ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES &&
  typeof value.eof === 'boolean' &&
  (value.eof || value.bytes.byteLength > 0);

/**
 * Echo a value that failed a rule, without echoing whatever the producer put in it.
 *
 * Which wrong value arrived is most of the diagnostic, but every field reported here is chosen by
 * the producer, and the rule failed precisely because it holds something unexpected. A result that
 * misfiles a path into `previewHint` would otherwise write that path into `onlypreview.log` — and
 * the failure wire rejects any message carrying a path separator, so the line would be dropped
 * whole. Echo a string only when it already looks like the short token the rule expected; report
 * anything else by type and length, which is enough to recognise "a path landed here".
 */
const echoValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(value) ? value : `<string:${value.length}>`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  return `<${typeof value}>`;
};

/**
 * Why a search batch was rejected — the rule name, not a boolean.
 *
 * `isOnlyPreviewGlobalSearchBatch` answers yes/no over a dozen rules and the relay turns any `no`
 * into one sentence: "the Project search index returned an invalid response". That sentence names
 * neither the rule nor the row, and the rejection **latches** the runtime, so the search is dead
 * until restart with no way to find out what did it. That happened to the owner twice (2026-09-17
 * disk-driven, 2026-09-21 batch-driven) and the second one was undiagnosable from the log by design.
 *
 * This runs ONLY after a rejection, so the accepting path pays nothing. It deliberately re-walks the
 * same rules in the same order rather than instrumenting them: a predicate that reports its own
 * failure has to thread a channel through every `&&`, and the first edit that forgets to would
 * silently go back to a bare `false`.
 *
 * **Emits rule names, indexes, kinds and lengths — never a path, a name or snippet text.** This
 * string reaches `onlypreview.log`, and the search wire's failure validator rejects any message
 * containing a path separator. Keeping it free of content is what lets it be logged at all.
 */
const describeResultRejection = (
  value: unknown,
  section: 'files' | 'contents'
): string | undefined => {
  if (!isRecord(value)) return 'not-a-record';
  const expected =
    section === 'files'
      ? ['mediaType', 'name', 'nodeKind', 'parentRelativePath', 'previewHint', 'relativePath', 'resultToken', 'section']
      : ['contentMatch', 'fileName', 'mediaType', 'parentRelativePath', 'relativePath', 'resultToken', 'section'];
  if (!exactKeys(value, expected)) {
    const actual = Reflect.ownKeys(value).filter((key) => typeof key === 'string') as string[];
    const missing = expected.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !expected.includes(key));
    return `exact-keys missing=[${missing.map(echoValue).join(',')}] extra=[${extra.map(echoValue).join(',')}]`;
  }
  if (value.section !== section) return `section=${echoValue(value.section)}`;
  if (!boundedToken(value.resultToken)) return 'resultToken';
  if (!relativePath(value.relativePath)) return 'relativePath-shape';
  if (!relativePath(value.parentRelativePath, true)) return 'parentRelativePath-shape';
  if (value.parentRelativePath !== parentOf(value.relativePath as string)) {
    // The producer computes the parent itself; a disagreement here is the two sides slicing the same
    // path differently, which is why the lengths are the useful part and the paths are not.
    return `parent-mismatch parentLen=${String(value.parentRelativePath).length} expectedLen=${parentOf(value.relativePath as string).length}`;
  }
  const nameKey = section === 'files' ? 'name' : 'fileName';
  if (!boundedString(value[nameKey], 4_096)) return `${nameKey}-bounds`;
  if (value[nameKey] !== basenameOf(value.relativePath as string)) {
    return `${nameKey}-mismatch len=${String(value[nameKey]).length} expectedLen=${basenameOf(value.relativePath as string).length}`;
  }
  if (section === 'files') {
    if (value.nodeKind !== 'file' && value.nodeKind !== 'directory') return `nodeKind=${echoValue(value.nodeKind)}`;
    if (!PREVIEW_HINTS.has(String(value.previewHint))) return `previewHint=${echoValue(value.previewHint)}`;
    if (!MEDIA_TYPES.has(String(value.mediaType))) return `mediaType=${echoValue(value.mediaType)}`;
    if (value.nodeKind === 'directory' && (value.previewHint !== 'unsupported' || value.mediaType !== 'unknown')) {
      return `directory-hint previewHint=${echoValue(value.previewHint)} mediaType=${echoValue(value.mediaType)}`;
    }
    return undefined;
  }
  if (value.mediaType !== 'text') return `mediaType=${echoValue(value.mediaType)}`;
  const match = value.contentMatch;
  if (!isRecord(match)) return 'contentMatch-not-a-record';
  if (!exactKeys(match, ['highlightLength', 'highlightStart', 'snippetText'])) return 'contentMatch-exact-keys';
  if (!boundedString(match.snippetText, 65_536)) {
    return `snippet-bounds len=${typeof match.snippetText === 'string' ? match.snippetText.length : -1}`;
  }
  if (!Number.isSafeInteger(match.highlightStart) || (match.highlightStart as number) < 0) {
    return `highlightStart=${echoValue(match.highlightStart)}`;
  }
  if (!Number.isSafeInteger(match.highlightLength) || (match.highlightLength as number) < 1) {
    return `highlightLength=${echoValue(match.highlightLength)}`;
  }
  const graphemes = [...segmenter.segment(match.snippetText as string)].length;
  if ((match.highlightStart as number) + (match.highlightLength as number) > graphemes) {
    return `highlight-overruns start=${echoValue(match.highlightStart)} length=${echoValue(match.highlightLength)} graphemes=${graphemes}`;
  }
  return undefined;
};

export const describeOnlyPreviewGlobalSearchBatchRejection = (
  value: unknown,
  expectation: SearchExpectation,
  maximum: number
): string => {
  if (!isRecord(value)) return 'batch not-a-record';
  if (!exactKeys(value, ['contents', 'files', 'generation', 'requestId', 'workspaceId'])) {
    return 'batch exact-keys';
  }
  if (!commonEnvelope(value, expectation)) return 'batch envelope workspace-generation-or-requestId';
  for (const section of ['files', 'contents'] as const) {
    const results = value[section];
    if (!Array.isArray(results)) return `${section} not-an-array`;
    if (results.length > maximum) return `${section} over-cap count=${results.length} maximum=${maximum}`;
    const seen = new Set<string>();
    for (const [index, result] of results.entries()) {
      const reason = describeResultRejection(result, section);
      if (reason) return `${section}[${index}] ${reason}`;
      const path = (result as { relativePath: string }).relativePath;
      if (seen.has(path)) return `${section}[${index}] duplicate-relativePath`;
      seen.add(path);
    }
  }
  const total = (value.files as unknown[]).length + (value.contents as unknown[]).length;
  if (total > maximum) return `batch over-cap total=${total} maximum=${maximum}`;
  // The rules above accepted everything. If the caller still rejected, the two walks disagree, which
  // is itself the bug worth reporting.
  return `batch rejected-but-no-rule-failed total=${total} maximum=${maximum}`;
};
