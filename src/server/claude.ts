import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import type { CaseFile } from '../case/types'

/** Claude Haiku 5.5 at low effort: every call here is a small classification or a short text. */
export const MODEL = 'claude-haiku-5-5'

let client: Anthropic | null = null
const anthropic = () => (client ??= new Anthropic())

export interface StructuredRequest<S extends z.ZodObject> {
  /** Names the step in the error if the model returns nothing. */
  label: string
  schema: S
  system: string
  content: string
  maxTokens?: number
}

export async function parseStructured<S extends z.ZodObject>(request: StructuredRequest<S>): Promise<z.infer<S>> {
  const { label, schema, system, content, maxTokens = 2000 } = request
  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'low', format: zodOutputFormat(schema) },
  })
  if (!response.parsed_output) throw new Error(`${label} returned no output (stop_reason: ${response.stop_reason})`)
  return response.parsed_output as z.infer<S>
}

export function caseBrief(viva: CaseFile): string {
  return `Case: ${viva.opening_prompt}
Expected diagnosis: ${viva.examiner_notes.diagnosis}
Key points a good answer covers:
${viva.examiner_notes.key_points.map((p) => `- ${p}`).join('\n')}`
}
