import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { CaseFile } from '../case/types'
import type { Classification, ExaminerModel, PreviousRequest } from '../viva/engine'

export const MODEL = 'claude-haiku-5-5'

let client: Anthropic | null = null
export const anthropic = () => (client ??= new Anthropic())

/**
 * The classifier sees the finding catalogue *without values*: it only picks ids.
 * It can't leak or invent a value because it never has one.
 */
function findingCatalogue(viva: CaseFile): string {
  return viva.findings
    .map((f) => `${f.id} | eye: ${f.eye ?? 'n/a'} | ${f.label}${f.method ? ` | ${f.method}` : ''}`)
    .join('\n')
}

const ClassificationSchema = z.object({
  intent: z.enum(['finding_request', 'too_broad', 'ready_to_answer', 'other']),
  finding_ids: z.array(z.string()),
})

function classifierSystem(viva: CaseFile): string {
  return `You route a trainee's spoken request in an ophthalmology practice viva. The text is a speech-to-text transcript, so expect mishearings and casual phrasing.

Findings in this case (id | eye | label | method):
${findingCatalogue(viva)}

Return:
- intent "finding_request" when they ask for any specific examination finding or test result, INCLUDING tests that are not in the list (visual fields, HbA1c, corneal thickness): those are finding_request with finding_ids []. Asking for one or a few named examinations is specific ("pressures, pupils and gonioscopy in both eyes" names three).
- intent "too_broad" when they ask for everything or an unspecified examination without naming what ("is there anything wrong with the left eye?", "examine the eye", "give me all the findings", "what else is abnormal?"). Return finding_ids [] for this.
- intent "ready_to_answer" when they say they are ready to give their diagnosis or management, or start giving it.
- intent "other" for anything else (greetings, questions about the viva, history questions).
- finding_ids: every id that matches what they asked for. Respect the eye: "right IOP" is only iop_right. If no eye is given, or they say "both", include every eye that has the finding. Abbreviations count (IOP = intraocular pressure, VA = visual acuity, RAPD, U&E, AC = anterior chamber). Return [] when nothing in the list matches; never invent ids.
- A short follow-on such as "and the left?" or "what about the other eye?" refers to their previous request, if one is given: apply it to the new eye or finding.

Never guess. Only return an id when the words clearly name that finding.
- A different measurement of the same structure is not a match: "corneal thickness" (pachymetry) is not the cornea finding; "visual fields" is not visual acuity. Return [].
- If a word is unrecognisable or doesn't name an examination (e.g. "right thunder", "precious"), don't map it to a likely-sounding finding: use intent "other" with [] so the trainee is asked again. Revealing a finding they didn't ask for is worse than asking them to repeat.`
}

export async function classify(viva: CaseFile, utterance: string, previous?: PreviousRequest): Promise<Classification> {
  const content = previous
    ? `Previous request: "${previous.utterance}" (answered with: ${previous.findingIds.join(', ') || 'nothing'})\nCurrent request: ${utterance}`
    : utterance
  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: classifierSystem(viva),
    messages: [{ role: 'user', content }],
    output_config: { effort: 'low', format: zodOutputFormat(ClassificationSchema) },
  })
  if (!response.parsed_output) throw new Error(`Classifier returned no output (stop_reason: ${response.stop_reason})`)
  return response.parsed_output
}

const FollowUpSchema = z.object({
  gap: z.string().describe('The key point the trainee missed or got wrong, in a few words'),
  question: z.string().describe('The one follow-up question the examiner says aloud'),
})

function followUpSystem(viva: CaseFile): string {
  const notes = viva.examiner_notes
  return `You are the examiner in a spoken ophthalmology practice viva. The trainee has just given their diagnosis and immediate management for this case.

Case: ${viva.opening_prompt}
Expected diagnosis: ${notes.diagnosis}
Key points a good answer covers:
${notes.key_points.map((p) => `- ${p}`).join('\n')}
Example follow-up questions:
${notes.follow_up_ideas.map((q) => `- ${q}`).join('\n')}

Ask exactly one follow-up question that responds to what the trainee actually said. Prefer the most important key point they missed or got wrong; if they covered everything, probe the reasoning behind one point they made. The question is spoken aloud: one sentence, under 30 words, no preamble, no feedback, and don't reveal the answer.`
}

export async function writeFollowUp(viva: CaseFile, diagnosisAnswer: string): Promise<{ gap: string; question: string }> {
  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: followUpSystem(viva),
    messages: [{ role: 'user', content: `Trainee's answer (speech-to-text transcript):\n${diagnosisAnswer}` }],
    output_config: { effort: 'low', format: zodOutputFormat(FollowUpSchema) },
  })
  if (!response.parsed_output) throw new Error(`Follow-up returned no output (stop_reason: ${response.stop_reason})`)
  return response.parsed_output
}

export const examinerModel = (viva: CaseFile): ExaminerModel => ({
  classify: (utterance, previous) => classify(viva, utterance, previous),
  writeFollowUp: async (answer) => (await writeFollowUp(viva, answer)).question,
})
