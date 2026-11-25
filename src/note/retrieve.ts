import note from '../../data/note-chunks.json'
import { cosine, embed } from '../server/embed'
import type { RetrievedPassage } from '../viva/attempt'
import { expandForEmbedding, findAbbreviations, type Chunk } from './chunk'

export type NoteChunk = Chunk & { embedding: number[] }
export const noteChunks = note.chunks as NoteChunk[]

/**
 * Hybrid retrieval: embedding similarity (meaning) + BM25 (exact terms such as "fellow eye"),
 * combined with reciprocal rank fusion. Embeddings alone ranked the key fellow-eye passage
 * (p6, "Prophylactic LPI in the fellow eye") 29th for a fellow-eye query: the distractor
 * pages about iridotomy in general scored higher. See README "Preparing the reference note".
 */
const STOP_WORDS = new Set('a an and are as at be by for from has have if in into is it its of on or that the then this to was were which with why what when how does do not can may also than'.split(' '))
const abbreviations = findAbbreviations(noteChunks.map((chunk) => chunk.text))
const tokens = (text: string) =>
  expandForEmbedding(text, abbreviations).toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => !STOP_WORDS.has(word)) ?? []

const chunkTokens = noteChunks.map((chunk) => tokens(`${chunk.section} ${chunk.text}`))
const averageLength = chunkTokens.reduce((sum, words) => sum + words.length, 0) / chunkTokens.length
const chunksContaining = new Map<string, number>()
for (const words of chunkTokens) for (const word of new Set(words)) chunksContaining.set(word, (chunksContaining.get(word) ?? 0) + 1)

function bm25(query: string): number[] {
  const queryWords = [...new Set(tokens(query))]
  const chunkCount = chunkTokens.length
  return chunkTokens.map((words) => {
    let score = 0
    for (const word of queryWords) {
      const termFrequency = words.filter((other) => other === word).length
      if (!termFrequency) continue
      const containing = chunksContaining.get(word)!
      const inverseDocumentFrequency = Math.log(1 + (chunkCount - containing + 0.5) / (containing + 0.5))
      score += (inverseDocumentFrequency * termFrequency * 2.2) / (termFrequency + 1.2 * (0.25 + 0.75 * (words.length / averageLength)))
    }
    return score
  })
}

const ranks = (scores: number[]) => {
  const order = scores.map((score, index) => [score, index] as const).sort((a, b) => b[0] - a[0])
  const rankByIndex = new Array<number>(scores.length)
  order.forEach(([, index], position) => (rankByIndex[index] = position + 1))
  return rankByIndex
}

/**
 * Union of the top `perMethod` chunks by meaning and the top `perMethod` by keyword (so each
 * method keeps what it is good at), ordered by reciprocal rank fusion. At most 2 x perMethod.
 * Plain fusion was tried first: it fixed the fellow-eye query but pushed out the
 * "If the IOP does not fall" passages that embeddings alone found.
 */
export async function retrieve(query: string, perMethod = 3): Promise<{ chunk: NoteChunk; score: number }[]> {
  const [queryEmbedding] = await embed([query], 'query')
  const semantic = ranks(noteChunks.map((chunk) => cosine(queryEmbedding, chunk.embedding)))
  const keyword = ranks(bm25(query))
  const RRF_K = 60
  return noteChunks
    .map((chunk, index) => ({ chunk, index, score: 1 / (RRF_K + semantic[index]) + 1 / (RRF_K + keyword[index]) }))
    .filter(({ index }) => semantic[index] <= perMethod || keyword[index] <= perMethod)
    .sort((a, b) => b.score - a.score)
    .map(({ chunk, score }) => ({ chunk, score }))
}

export const summarise = (hits: { chunk: NoteChunk; score: number }[]): RetrievedPassage[] =>
  hits.map(({ chunk, score }) => ({ chunkId: chunk.id, pages: chunk.pages, section: chunk.section, score: Number(score.toFixed(4)) }))
