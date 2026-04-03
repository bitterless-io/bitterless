import { join } from 'path';
import { getModelsDir } from './modelPath.helper';

const MODEL_NAME = 'Qwen3-Reranker-0.6B-Q8_0.gguf';

let rerankModel: any = null;
let rankingContext: any = null;

export interface RankedDocument {
  document: string;
  score: number;
  index: number;
}

/**
 * Initialize the reranker model and context.
 */
export const initRerank = async (): Promise<void> => {
  if (rankingContext) return;

  const { getLlama } = await import('node-llama-cpp');
  const modelsDir = await getModelsDir();
  const modelPath = join(modelsDir, MODEL_NAME);

  console.log('[rerank] loading model:', modelPath);
  const llama = await getLlama();
  rerankModel = await llama.loadModel({ modelPath });
  rankingContext = await rerankModel.createRankingContext();
  console.log('[rerank] model loaded');
};

/**
 * Rerank documents by relevance to the query.
 * Returns documents sorted by relevance score (highest first).
 */
export const rerank = async (query: string, documents: string[]): Promise<RankedDocument[]> => {
  if (!rankingContext) {
    throw new Error('[rerank] not initialized, call initRerank() first');
  }

  const ranked = await rankingContext.rankAndSort(query, documents);
  return ranked.map((item) => ({
    document: item.document,
    score: item.score,
    index: documents.indexOf(item.document),
  }));
};

/**
 * Dispose the reranker model and context.
 */
export const disposeRerank = async (): Promise<void> => {
  if (rankingContext) {
    await rankingContext.dispose();
    rankingContext = null;
  }
  if (rerankModel) {
    await rerankModel.dispose();
    rerankModel = null;
  }
};
