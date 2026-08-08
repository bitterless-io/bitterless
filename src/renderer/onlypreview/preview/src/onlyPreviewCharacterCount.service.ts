export type OnlyPreviewSegmenter = Pick<Intl.Segmenter, 'segment'>;

const createOnlyPreviewSegmenter = (): OnlyPreviewSegmenter | null => {
  if (typeof Intl.Segmenter !== 'function') return null;
  return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
};

export const countOnlyPreviewGraphemes = (
  value: string,
  segmenter: OnlyPreviewSegmenter | null = createOnlyPreviewSegmenter()
): number => {
  if (!value) return 0;
  if (!segmenter) return Array.from(value).length;
  return Array.from(segmenter.segment(value)).length;
};

export const countOnlyPreviewSelectionTexts = (
  values: readonly string[],
  segmenter: OnlyPreviewSegmenter | null = createOnlyPreviewSegmenter()
): number =>
  values.reduce((total, value) => total + countOnlyPreviewGraphemes(value, segmenter), 0);

export const countOnlyPreviewDomSelection = (
  root: HTMLElement | null,
  selection: Selection | null
): number => {
  if (
    !root ||
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return 0;
  }

  return countOnlyPreviewGraphemes(selection.toString());
};
