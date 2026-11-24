import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

/**
 * Local embeddings (no API key): BGE-small, 384 dimensions, run with transformers.js.
 * The model downloads once (~130 MB, full precision) and is cached. BGE expects queries to carry an instruction prefix.
 */
export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5'
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

let extractor: Promise<FeatureExtractionPipeline> | null = null
const getExtractor = () => (extractor ??= pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'fp32' }))

export async function embed(texts: string[], kind: 'passage' | 'query'): Promise<number[][]> {
  const model = await getExtractor()
  const inputs = kind === 'query' ? texts.map((t) => QUERY_PREFIX + t) : texts
  const output = await model(inputs, { pooling: 'cls', normalize: true })
  return output.tolist() as number[][]
}

/** Vectors are normalised, so the dot product is the cosine similarity. */
export function cosine(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
