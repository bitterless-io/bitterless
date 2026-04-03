import { join } from 'path';
import { getModelsDir } from './modelPath.helper';

const MODEL_NAME = 'Qwen3-Embedding-0.6B-Q8_0.gguf';

let embeddingModel: any = null;
let embeddingContext: any = null;

/**
 * Initialize the embedding model and context.
 */
export const initEmbedding = async (): Promise<void> => {
  if (embeddingContext) return;

  const { getLlama } = await import('node-llama-cpp');
  const modelsDir = await getModelsDir();
  const modelPath = join(modelsDir, MODEL_NAME);

  console.log('[embedding] loading model:', modelPath);
  const llama = await getLlama();
  embeddingModel = await llama.loadModel({ modelPath });
  embeddingContext = await embeddingModel.createEmbeddingContext();
  console.log('[embedding] model loaded');
};

/**
 * Get the embedding vector for a given text.
 */
export const getEmbedding = async (text: string): Promise<number[]> => {
  if (!embeddingContext) {
    throw new Error('[embedding] not initialized, call initEmbedding() first');
  }
  const embedding = await embeddingContext.getEmbeddingFor(text);
  return Array.from(embedding.vector);
};

/**
 * Get embeddings for multiple texts in batch.
 */
export const getEmbeddings = async (texts: string[]): Promise<number[][]> => {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await getEmbedding(text));
  }
  return results;
};

/**
 * Get the embedding vector dimension.
 */
export const getEmbeddingDimension = (): number => {
  if (!embeddingModel) {
    throw new Error('[embedding] not initialized');
  }
  return embeddingModel.embeddingVectorSize;
};

/**
 * Dispose the embedding model and context.
 */
export const disposeEmbedding = async (): Promise<void> => {
  if (embeddingContext) {
    await embeddingContext.dispose();
    embeddingContext = null;
  }
  if (embeddingModel) {
    await embeddingModel.dispose();
    embeddingModel = null;
  }
};
