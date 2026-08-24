import type * as Monaco from 'monaco-editor';
import type { OnlyPreviewFindCommand } from '@shared/onlypreview/onlyPreview.types';
import type {
  OnlyPreviewContentFindAdapter,
  OnlyPreviewContentFindAdapterResult
} from './onlyPreviewFindAdapter.service';

const countLiteralMatches = (text: string, query: string): number => {
  let searchOffset = 0;
  let matches = 0;
  if (!query) return matches;
  while (searchOffset <= text.length - query.length) {
    const startOffset = text.indexOf(query, searchOffset);
    if (startOffset < 0) break;
    matches += 1;
    searchOffset = startOffset + query.length;
  }
  return matches;
};

export const createOnlyPreviewMonacoFindAdapter = (
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel
): OnlyPreviewContentFindAdapter & { dispose(): void } => {
  const decorations = editor.createDecorationsCollection();
  const sourceText = model.getValue();
  let searchableText = sourceText;
  let searchableQuery = '';
  let query = '';
  let caseSensitive = false;
  let matchCount = 0;
  let activeOrdinal = 0;
  let activeRange: Monaco.Range | null = null;

  const reveal = (range: Monaco.Range | null): void => {
    decorations.set(
      range
        ? [
            {
              range,
              options: { inlineClassName: 'onlypreview-monaco__find-match--active' }
            }
          ]
        : []
    );
    if (range) editor.revealRangeInCenter(range);
  };

  const findModelRange = (direction: OnlyPreviewFindCommand['direction']): Monaco.Range | null => {
    const searchStart = activeRange
      ? direction === 'forward'
        ? { lineNumber: activeRange.endLineNumber, column: activeRange.endColumn }
        : { lineNumber: activeRange.startLineNumber, column: activeRange.startColumn }
      : model.getPositionAt(direction === 'forward' ? 0 : model.getValueLength());
    const match =
      direction === 'forward'
        ? model.findNextMatch(query, searchStart, false, caseSensitive, null, false)
        : model.findPreviousMatch(query, searchStart, false, caseSensitive, null, false);
    return match?.range ?? null;
  };

  const execute = async (
    command: OnlyPreviewFindCommand
  ): Promise<OnlyPreviewContentFindAdapterResult> => {
    const newQuery =
      command.findNext || command.query !== query || command.caseSensitive !== caseSensitive;
    if (newQuery) {
      query = command.query;
      caseSensitive = command.caseSensitive;
      searchableText = caseSensitive ? sourceText : sourceText.toLowerCase();
      searchableQuery = caseSensitive ? query : query.toLowerCase();
      matchCount = countLiteralMatches(searchableText, searchableQuery);
      activeOrdinal = matchCount ? (command.direction === 'backward' ? matchCount : 1) : 0;
      activeRange = null;
      activeRange = matchCount ? findModelRange(command.direction) : null;
    } else if (matchCount) {
      activeOrdinal =
        command.direction === 'forward'
          ? (activeOrdinal % matchCount) + 1
          : ((activeOrdinal - 2 + matchCount) % matchCount) + 1;
      activeRange = findModelRange(command.direction);
    }
    reveal(activeRange);
    return {
      activeMatchOrdinal: activeOrdinal,
      matches: matchCount,
      finalUpdate: true,
      coverage: { kind: 'complete' }
    };
  };

  const clear = (): void => {
    query = '';
    caseSensitive = false;
    matchCount = 0;
    activeOrdinal = 0;
    activeRange = null;
    searchableText = sourceText;
    searchableQuery = '';
    decorations.clear();
  };

  return {
    execute,
    clear,
    dispose: () => {
      clear();
      decorations.clear();
    }
  };
};
