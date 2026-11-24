import { z } from 'zod'
import type { CaseFile } from '../case/types'
import { locateExcerpt } from '../note/chunk'
import { retrieve, summarise } from '../note/retrieve'
import type { RevisionPoint } from '../viva/attempt'
import { caseBrief, parseStructured } from './claude'

export interface RevisionInput {
  diagnosisAnswer: string
  followUpQuestion?: string
  followUpAnswer: string
}

/** "A short supporting excerpt": the model is asked for 10-40 words; longer quotes are rejected. */
export const MAX_EXCERPT_WORDS = 50

const GapSchema = z.object({
  gap: z.string().describe('The single most important thing the trainee missed or got wrong, in under 12 words'),
  query: z.string().describe('A search query for a revision note that would find the passage explaining this'),
})

const PointSchema = z.object({
  supported: z.boolean(),
  chunk_id: z.string().nullable(),
  excerpt: z.string().nullable().describe('Copied word for word from the chosen passage, 10 to 40 words'),
  point: z.string().nullable().describe('One or two sentences addressed to the trainee'),
  reason: z.string().nullable().describe('If unsupported: why none of the passages supports a revision point'),
})

function answers(input: RevisionInput): string {
  return [
    `Diagnosis and management answer: ${input.diagnosisAnswer || '(none given)'}`,
    input.followUpQuestion ? `Follow-up question: ${input.followUpQuestion}` : '',
    `Follow-up answer: ${input.followUpAnswer || '(none given)'}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Step 1: compare the trainee's answers with the case key points to find the biggest gap. */
export function findGap(viva: CaseFile, input: RevisionInput) {
  return parseStructured(
    'Gap step',
    GapSchema,
    `You review a trainee's answers in an ophthalmology practice viva.
${caseBrief(viva)}

Identify the single most important key point the trainee missed or got wrong. If they covered everything, pick the point where their reasoning was weakest.`,
    answers(input),
  )
}

/**
 * The full revision step: gap -> retrieve passages -> one point with a verbatim excerpt.
 * Code, not the model, decides whether the citation stands: the excerpt must be in the chosen
 * retrieved passage, and the cited page is where that excerpt is printed.
 */
export async function revisionPoint(viva: CaseFile, input: RevisionInput): Promise<RevisionPoint> {
  const { gap, query } = await findGap(viva, input)
  return pointFromNote(viva, input, gap, query)
}

/** Retrieve passages for a gap and write one point, or report that the note doesn't support one. */
export async function pointFromNote(viva: CaseFile, input: RevisionInput, gap: string, query: string): Promise<RevisionPoint> {
  const hits = await retrieve(query)
  const retrieved = summarise(hits)

  const passages = hits
    .map(({ chunk }) => `<passage id="${chunk.id}" pages="${chunk.pages.join('-')}" section="${chunk.section}">\n${chunk.text}\n</passage>`)
    .join('\n')

  const out = await parseStructured(
    'Revision step',
    PointSchema,
    `You write one revision point for a trainee after an ophthalmology practice viva, using only the reference note passages provided.

The expected diagnosis for this case is: ${viva.examiner_notes.diagnosis}
Prefer passages about this condition and its management over passages about other conditions that happen to share words.

If a passage directly supports a revision point about the gap: set supported=true, give its chunk_id, copy a short excerpt from it WORD FOR WORD (no paraphrase, no added or removed words, 10 to 40 words), and write the point in one or two sentences addressed to the trainee ("you").
If no passage supports it: set supported=false and explain briefly in "reason". Do not use outside knowledge.`,
    `${answers(input)}\n\nGap to address: ${gap}\n\nReference note passages:\n${passages}`,
    3000,
  )

  if (!out.supported || !out.chunk_id || !out.excerpt || !out.point) {
    return { status: 'unsupported', gap, reason: out.reason ?? 'No retrieved passage supports this point.', retrieved }
  }
  const chunk = hits.find((h) => h.chunk.id === out.chunk_id)?.chunk
  const found = chunk ? locateExcerpt(chunk, out.excerpt) : null
  if (!chunk || !found) {
    // The model cited something that isn't in what we retrieved: don't show it as support.
    return { status: 'unsupported', gap, reason: 'A supporting quote could not be verified word for word in the note.', retrieved }
  }
  if (found.text.split(/\s+/).length > MAX_EXCERPT_WORDS) {
    return { status: 'unsupported', gap, reason: 'The supporting quote was too long to show as a short excerpt.', retrieved }
  }
  // Show the note's own text for the quote (not the model's copy of it), and every page it is printed on.
  return {
    status: 'supported',
    gap,
    point: out.point,
    excerpt: found.text,
    page: found.pages[0],
    pages: found.pages,
    chunkId: chunk.id,
    retrieved,
  }
}
