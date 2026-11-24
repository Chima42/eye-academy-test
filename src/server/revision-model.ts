import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { CaseFile } from '../case/types'
import { locateExcerpt } from '../note/chunk'
import { retrieve, summarise } from '../note/retrieve'
import type { RevisionPoint } from '../viva/attempt'
import { MODEL, anthropic } from './examiner-model'

export interface RevisionInput {
  diagnosisAnswer: string
  followUpQuestion?: string
  followUpAnswer: string
}

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
export async function findGap(viva: CaseFile, input: RevisionInput) {
  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: `You review a trainee's answers in an ophthalmology practice viva.
Case: ${viva.opening_prompt}
Expected diagnosis: ${viva.examiner_notes.diagnosis}
Key points a good answer covers:
${viva.examiner_notes.key_points.map((p) => `- ${p}`).join('\n')}

Identify the single most important key point the trainee missed or got wrong. If they covered everything, pick the point where their reasoning was weakest.`,
    messages: [{ role: 'user', content: answers(input) }],
    output_config: { effort: 'low', format: zodOutputFormat(GapSchema) },
  })
  if (!response.parsed_output) throw new Error(`Gap step returned no output (stop_reason: ${response.stop_reason})`)
  return response.parsed_output
}

/**
 * The full revision step: gap -> retrieve passages -> one point with a verbatim excerpt.
 * Code, not the model, decides whether the citation stands: the excerpt must be word for word
 * in the chosen retrieved passage, and the cited page is the page that excerpt is printed on.
 */
export async function revisionPoint(viva: CaseFile, input: RevisionInput): Promise<RevisionPoint> {
  const { gap, query } = await findGap(viva, input)
  return pointFromNote(input, gap, query)
}

/** Retrieve passages for a gap and write one point, or report that the note doesn't support one. */
export async function pointFromNote(input: RevisionInput, gap: string, query: string): Promise<RevisionPoint> {
  const hits = await retrieve(query)
  const retrieved = summarise(hits)

  const passages = hits
    .map(({ chunk }) => `<passage id="${chunk.id}" pages="${chunk.pages.join('-')}" section="${chunk.section}">\n${chunk.text}\n</passage>`)
    .join('\n')

  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 3000,
    system: `You write one revision point for a trainee after an ophthalmology practice viva, using only the reference note passages provided.

The case is acute primary angle closure. Prefer passages about this condition and its management over passages about other conditions that happen to share words.

If a passage directly supports a revision point about the gap: set supported=true, give its chunk_id, copy a short excerpt from it WORD FOR WORD (no paraphrase, no added or removed words, 10 to 40 words), and write the point in one or two sentences addressed to the trainee ("you").
If no passage supports it: set supported=false and explain briefly in "reason". Do not use outside knowledge.`,
    messages: [
      {
        role: 'user',
        content: `${answers(input)}\n\nGap to address: ${gap}\n\nReference note passages:\n${passages}`,
      },
    ],
    output_config: { effort: 'low', format: zodOutputFormat(PointSchema) },
  })
  const out = response.parsed_output
  if (!out) throw new Error(`Revision step returned no output (stop_reason: ${response.stop_reason})`)

  if (!out.supported || !out.chunk_id || !out.excerpt || !out.point) {
    return { status: 'unsupported', gap, reason: out.reason ?? 'No retrieved passage supports this point.', retrieved }
  }
  const chunk = hits.find((h) => h.chunk.id === out.chunk_id)?.chunk
  const page = chunk ? locateExcerpt(chunk, out.excerpt) : null
  if (!chunk || page === null) {
    // The model cited something that isn't verbatim in what we retrieved: don't show it as support.
    return {
      status: 'unsupported',
      gap,
      reason: 'A supporting quote could not be verified word for word in the note.',
      retrieved,
    }
  }
  return { status: 'supported', gap, point: out.point, excerpt: out.excerpt.trim(), page, chunkId: chunk.id, retrieved }
}
