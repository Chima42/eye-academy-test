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
const STOP = new Set('a an and are as at be by for from has have if in into is it its of on or that the then this to was were which with why what when how does do not can may also than'.split(' '))
const abbreviations = findAbbreviations(noteChunks.map((c) => c.text))
const tokens = (t: string) =>
  expandForEmbedding(t, abbreviations).toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w)) ?? []

const docs = noteChunks.map((c) => tokens(`${c.section} ${c.text}`))
const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length
const df = new Map<string, number>()
for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1)

function bm25(query: string): number[] {
  const q = [...new Set(tokens(query))]
  const N = docs.length
  return docs.map((d) => {
    let score = 0
    for (const w of q) {
      const tf = d.filter((x) => x === w).length
      if (!tf) continue
      const idf = Math.log(1 + (N - df.get(w)! + 0.5) / (df.get(w)! + 0.5))
      score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avgLen)))
    }
    return score
  })
}

const ranks = (scores: number[]) => {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0])
  const r = new Array<number>(scores.length)
  order.forEach(([, i], pos) => (r[i] = pos + 1))
  return r
}

/**
 * Union of the top `perMethod` chunks by meaning and the top `perMethod` by keyword (so each
 * method keeps what it is good at), ordered by reciprocal rank fusion. At most 2 x perMethod.
 * Plain fusion was tried first: it fixed the fellow-eye query but pushed out the
 * "If the IOP does not fall" passages that embeddings alone found.
 */
export async function retrieve(query: string, perMethod = 3): Promise<{ chunk: NoteChunk; score: number }[]> {
  const [q] = await embed([query], 'query')
  const semantic = ranks(noteChunks.map((c) => cosine(q, c.embedding)))
  const keyword = ranks(bm25(query))
  const RRF_K = 60
  return noteChunks
    .map((chunk, i) => ({ chunk, i, score: 1 / (RRF_K + semantic[i]) + 1 / (RRF_K + keyword[i]) }))
    .filter(({ i }) => semantic[i] <= perMethod || keyword[i] <= perMethod)
    .sort((a, b) => b.score - a.score)
    .map(({ chunk, score }) => ({ chunk, score }))
}

export const summarise = (hits: { chunk: NoteChunk; score: number }[]): RetrievedPassage[] =>
  hits.map(({ chunk, score }) => ({ chunkId: chunk.id, pages: chunk.pages, section: chunk.section, score: Number(score.toFixed(4)) }))
