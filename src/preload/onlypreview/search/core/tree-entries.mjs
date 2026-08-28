const treeEntryCollator = new Intl.Collator('und', { numeric: true, sensitivity: 'base' });

export const compareOnlyPreviewTreeEntries = (left, right) => {
  const leftSegments = left.relativePath.split('/');
  const rightSegments = right.relativePath.split('/');
  const length = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    if (leftSegments[index] === rightSegments[index]) continue;
    const leftIsParent = index === leftSegments.length - 1 && left.nodeKind === 'directory';
    const rightIsParent = index === rightSegments.length - 1 && right.nodeKind === 'directory';
    if (leftIsParent !== rightIsParent) return leftIsParent ? -1 : 1;
    return (
      treeEntryCollator.compare(leftSegments[index], rightSegments[index]) ||
      leftSegments[index].localeCompare(rightSegments[index], 'und')
    );
  }
  return leftSegments.length - rightSegments.length;
};

export const sortOnlyPreviewTreeEntries = (entries) =>
  [...entries].sort(compareOnlyPreviewTreeEntries);
