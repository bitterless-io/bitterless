import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';

/** Keep file authority/readers alive while routing a target before any visible host exists. */
export const withOnlyPreviewReadRuntime = async <T>(operation: () => Promise<T>): Promise<T> => {
  const release = await fileSearchWindowService.acquirePreviewRuntime();
  try {
    return await operation();
  } finally {
    release();
  }
};
