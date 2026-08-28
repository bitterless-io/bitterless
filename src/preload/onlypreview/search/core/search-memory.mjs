import { ONE_GIB_BYTES, TWO_GIB_BYTES } from './constants.mjs';

const estimateTreeMetadataBytes = (entries) =>
  entries.reduce(
    (total, entry) =>
      total +
      96 +
      2 *
        (entry.relativePath.length +
          entry.parentRelativePath.length +
          entry.name.length +
          entry.previewHint.length +
          entry.mediaType.length),
    0
  );

export const assessOnlyPreviewSearchMemory = ({
  measurementComplete,
  processRssBytes,
  workerHeapUsedBytes,
  workerExternalBytes,
  filenameTierEstimatedBytes,
  treeMetadataEntryCount,
  treeMetadataEstimatedBytes,
  diskIndexBytes
}) => {
  const runtimeSignals = [
    processRssBytes,
    workerHeapUsedBytes,
    workerExternalBytes,
    filenameTierEstimatedBytes
  ].filter((value) => Number.isFinite(value));
  return {
    measurementComplete,
    processRssBytes,
    workerHeapUsedBytes,
    workerExternalBytes,
    filenameTierEstimatedBytes,
    treeMetadataEntryCount,
    treeMetadataEstimatedBytes,
    diskIndexBytes,
    runtimeOneGiBWarning: runtimeSignals.some((value) => value > ONE_GIB_BYTES),
    runtimeTwoGiBLimitExceeded: runtimeSignals.some((value) => value > TWO_GIB_BYTES)
  };
};

export const measureOnlyPreviewSearchMemory = async ({ index, treeEntries, treeMetadataReady }) => {
  const usage = process.memoryUsage();
  return assessOnlyPreviewSearchMemory({
    measurementComplete: index !== undefined && treeMetadataReady,
    processRssBytes: usage.rss,
    workerHeapUsedBytes: usage.heapUsed,
    workerExternalBytes: usage.external,
    filenameTierEstimatedBytes: index?.filenameTier.statistics().estimatedBytes ?? null,
    treeMetadataEntryCount: treeMetadataReady ? treeEntries.length : null,
    treeMetadataEstimatedBytes: treeMetadataReady ? estimateTreeMetadataBytes(treeEntries) : null,
    diskIndexBytes: index ? await index.diskBytes() : null
  });
};
