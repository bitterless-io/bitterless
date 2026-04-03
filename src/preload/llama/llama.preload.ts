import 'electron-xpc/preload';
import { xpcRenderer } from 'electron-xpc/preload';
import { initEmbedding, getEmbedding, getEmbeddings, getEmbeddingDimension } from './llamaHelper/embedding.helper';
import { initRerank, rerank } from './llamaHelper/rerank.helper';

const bootstrap = async (): Promise<void> => {
  try {
    await initEmbedding();
    console.log('[llama.preload] embedding model ready');
  } catch (err: any) {
    console.error('[llama.preload] embedding init failed:', err.message);
  }

  try {
    await initRerank();
    console.log('[llama.preload] rerank model ready');
  } catch (err: any) {
    console.error('[llama.preload] rerank init failed:', err.message);
  }

  // Register xpc handlers so other processes can call embedding/rerank
  xpcRenderer.handle('llama/embedding', async (payload) => {
    const { text } = payload.params || {};
    if (!text) return null;
    return await getEmbedding(text);
  });

  xpcRenderer.handle('llama/embedding/batch', async (payload) => {
    const { texts } = payload.params || {};
    if (!texts || !Array.isArray(texts)) return null;
    return await getEmbeddings(texts);
  });

  xpcRenderer.handle('llama/embedding/dimension', async () => {
    return getEmbeddingDimension();
  });

  xpcRenderer.handle('llama/rerank', async (payload) => {
    const { query, documents } = payload.params || {};
    if (!query || !documents) return null;
    return await rerank(query, documents);
  });

  console.log('[llama.preload] xpc handlers registered');
};

bootstrap().catch((err) => console.error('[llama.preload] bootstrap failed:', err));
