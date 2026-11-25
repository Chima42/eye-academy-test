import { z } from 'zod'
import type { CaseFile } from '../case/types'
import { ClassificationSchema, type Classification, type ClassifyRequest, type ExaminerModel } from '../viva/engine'
import { caseBrief, parseStructured } from './claude'

/**
 * The classifier sees the finding catalogue *without values*: it only picks ids.
 * It can't leak or invent a value because it never has one.
 */
function findingCatalogue(viva: CaseFile): string {
  return viva.findings
    .map((f) => `${f.id} | eye: ${f.eye ?? 'n/a'} | ${f.label}${f.method ? ` | ${f.method}` : ''}`)
    .join('\n')
}

// `named` comes first so the model decides what was named before choosing the intent:
// a request that names an examination is never "too_broad" ("tell me about the pressure of the eye").
const ClassifierOutputSchema = z.object({
  named: z.array(z.string()).describe('Examinations or tests the words name, e.g. ["intraocular pressure"]; [] if none'),
  ...ClassificationSchema.shape,
})

function classifierSystem(viva: CaseFile): string {
  return `You route a trainee's spoken request in an ophthalmology practice viva. The text is a speech-to-text transcript, so expect mishearings and casual phrasing.

Findings in this case (id | eye | label | method):
${findingCatalogue(viva)}

Return:
- intent "finding_request" when they ask for any specific examination finding or test result, INCLUDING tests that are not in the list (visual fields, HbA1c, corneal thickness): those are finding_request with finding_ids []. Asking for one or a few named examinations is specific ("pressures, pupils and gonioscopy in both eyes" names three).
- intent "too_broad" when they ask for everything or an unspecified examination without naming what ("is there anything wrong with the left eye?", "examine the eye", "give me all the findings", "what else is abnormal?"). Return finding_ids [] for this. Only use too_broad when "named" is empty: if the words name any examination, it is finding_request however it is phrased ("talk to me about the acuity of the eye", "tell me about the pressure of the eye"). "The eye" with no side means both eyes.
- intent "ready_to_answer" when they say they are ready to give their diagnosis or management, without giving it yet.
- intent "gives_answer" when they actually state their diagnosis and/or management as their answer ("this is acute angle closure, I'd give timolol…"). Not for a question that mentions a condition ("could this be glaucoma? what's the pressure?").
- intent "repeat_request" when they ask to hear the examiner's question again ("sorry, can you repeat that?").
- intent "other" for anything else (greetings, questions about the viva, history questions).
- not_in_case: every test they asked for that is not in the list, in their words ("pressure and visual fields" -> ["visual fields"]). A request can have both finding_ids and not_in_case.
- finding_ids: every id that matches what they asked for. Respect the eye: "right IOP" is only iop_right. If no eye is given, or they say "both", include every eye that has the finding. Abbreviations count (IOP = intraocular pressure, VA = visual acuity, RAPD, U&E, AC = anterior chamber). Return [] when nothing in the list matches; never invent ids.
- A short follow-on such as "and the left?" or "what about the other eye?" refers to their previous request, if one is given: apply it to the new eye or finding.

Never guess. Only return an id when the words clearly name that finding.
- Return only the findings named, not related ones: "pupils" is the pupil findings only; the RAPD only when they ask for it (RAPD, afferent defect, swinging light test).
- A different measurement of the same structure is not a match: "corneal thickness" (pachymetry) is not the cornea finding; "visual fields" is not visual acuity. Return [].
- If a word is unrecognisable or doesn't name an examination (e.g. "right thunder", "precious"), don't map it to a likely-sounding finding: use intent "other" with [] so the trainee is asked again. Revealing a finding they didn't ask for is worse than asking them to repeat.`
}

const ANSWER_STAGE_GUIDE = `The trainee is now answering the examiner's question, so treat what they say as their answer ("gives_answer"), including "I don't know" and answers that mention findings ("I'd lower the pressure with timolol").
Only two exceptions: "finding_request" for an explicit request for a finding ("what's the left pressure?"), and "repeat_request" for asking to hear the question again.`

export async function classify(viva: CaseFile, request: ClassifyRequest): Promise<Classification> {
  const { utterance, previous, stage } = request
  const lines = [
    stage === 'findings' ? '' : `Stage: ${stage === 'diagnosis' ? 'giving their diagnosis and management' : 'answering the follow-up question'}.\n${ANSWER_STAGE_GUIDE}`,
    previous ? `Previous request: "${previous.utterance}" (answered with: ${previous.findingIds.join(', ') || 'nothing'})` : '',
    previous || stage !== 'findings' ? `Current request: ${utterance}` : utterance,
  ]
  const content = lines.filter(Boolean).join('\n')
  return parseStructured({ label: 'Classifier', schema: ClassifierOutputSchema, system: classifierSystem(viva), content })
}

const FollowUpSchema = z.object({
  gap: z.string().describe('The key point the trainee missed or got wrong, in a few words (think about this before writing the question)'),
  question: z.string().describe('The one follow-up question the examiner says aloud'),
})

function followUpSystem(viva: CaseFile): string {
  return `You are the examiner in a spoken ophthalmology practice viva. The trainee has just given their diagnosis and immediate management for this case.

${caseBrief(viva)}
Example follow-up questions:
${viva.examiner_notes.follow_up_ideas.map((q) => `- ${q}`).join('\n')}

Ask exactly one follow-up question that responds to what the trainee actually said. Prefer the most important key point they missed or got wrong; if they covered everything, probe the reasoning behind one point they made. The question is spoken aloud: one sentence, under 30 words, no preamble, no feedback, and don't reveal the answer.`
}

export async function writeFollowUp(viva: CaseFile, diagnosisAnswer: string): Promise<{ gap: string; question: string }> {
  return parseStructured({
    label: 'Follow-up',
    schema: FollowUpSchema,
    system: followUpSystem(viva),
    content: `Trainee's answer (speech-to-text transcript):\n${diagnosisAnswer}`,
  })
}

export const examinerModel = (viva: CaseFile): ExaminerModel => ({
  classify: (request) => classify(viva, request),
  writeFollowUp: async (answer) => (await writeFollowUp(viva, answer)).question,
})
