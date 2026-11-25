import { z } from 'zod'
import { replyForFindings } from '../case/format'
import type { CaseFile, RevealedFinding } from '../case/types'

export const StageSchema = z.enum(['findings', 'diagnosis', 'follow_up', 'complete'])
export type Stage = z.infer<typeof StageSchema>

export const IntentSchema = z.enum(['finding_request', 'too_broad', 'ready_to_answer', 'gives_answer', 'repeat_request', 'other'])
export type Intent = z.infer<typeof IntentSchema>

export const ClassificationSchema = z.object({
  intent: IntentSchema,
  finding_ids: z.array(z.string()),
  not_in_case: z.array(z.string()).describe('Tests they asked for that are not in the list, in their words, e.g. ["visual fields"]; [] otherwise'),
})
export type Classification = z.infer<typeof ClassificationSchema>

/** The trainee's previous findings request, so "what about the left eye?" can be understood. */
export const PreviousRequestSchema = z.object({
  utterance: z.string().max(4000),
  findingIds: z.array(z.string()).max(30),
})
export type PreviousRequest = z.infer<typeof PreviousRequestSchema>

export const TurnInputSchema = z.object({
  stage: StageSchema,
  utterance: z.string().max(4000),
  diagnosisAnswer: z.string().max(4000).optional(),
  /** The follow-up already asked, so it can be repeated on request. */
  followUpQuestion: z.string().max(1000).optional(),
  previous: PreviousRequestSchema.optional(),
})
export type TurnInput = z.infer<typeof TurnInputSchema>

export type ClassifyRequest = Pick<TurnInput, 'utterance' | 'stage' | 'previous'>

/** The LLM calls the engine needs. Injected so tests can use fakes or the real model. */
export interface ExaminerModel {
  classify(request: ClassifyRequest): Promise<Classification>
  writeFollowUp(diagnosisAnswer: string): Promise<string>
}

export interface Examiner {
  viva: CaseFile
  model: ExaminerModel
}

export interface TurnResult {
  spoken: string
  revealed: RevealedFinding[]
  nextStage: Stage
  /** False when nothing usable was heard: the turn doesn't count. */
  counted: boolean
  followUpQuestion?: string
  diagnosisAnswer?: string
}

export const PROMPTS = {
  didntCatch: "Sorry, I didn't catch that. Could you say it again?",
  askForAnswer: "Go ahead. What's your diagnosis, and what's your immediate management?",
  steer: "The history is on screen. Ask me for an examination finding, or tell me you're ready to give your diagnosis.",
  tooBroad: 'Which examination would you like? For example, the visual acuity, the pressure, or the pupils.',
  closing: "Thank you, that's the end of the viva. I'll put together a revision point for you.",
}

function isTooShortToCount(utterance: string): boolean {
  return utterance.replace(/[^\p{L}\p{N}]/gu, '').length < 2
}

const say = (spoken: string, nextStage: Stage): TurnResult => ({ spoken, revealed: [], nextStage, counted: true })

export async function runTurn(examiner: Examiner, input: TurnInput): Promise<TurnResult> {
  const { stage, utterance } = input
  if (isTooShortToCount(utterance)) return { ...say(PROMPTS.didntCatch, stage), counted: false }
  if (stage === 'complete') return { ...say(PROMPTS.closing, 'complete'), counted: false }

  const classification = await examiner.model.classify({ utterance, stage, previous: input.previous })
  const { intent } = classification
  const findingsReply = (): TurnResult => ({ ...replyFromCase(examiner.viva, classification), nextStage: stage, counted: true })

  if (intent === 'finding_request') return findingsReply()

  if (stage === 'findings') {
    if (intent === 'ready_to_answer') return say(PROMPTS.askForAnswer, 'diagnosis')
    // They gave the diagnosis without announcing it first: take it as their answer, don't ask again.
    if (intent === 'gives_answer') return answerDiagnosis(examiner.model, utterance)
    // "Is there anything wrong with the left eye?" would reveal the whole examination at once;
    // asking for findings one by one is the skill being tested, so ask which examination.
    if (intent === 'too_broad') return say(PROMPTS.tooBroad, stage)
    if (classification.finding_ids.length > 0) return findingsReply()
    return say(PROMPTS.steer, stage)
  }

  // Answer stages: "can you repeat the question?" is not an answer.
  if (stage === 'diagnosis') {
    if (intent === 'repeat_request') return say(PROMPTS.askForAnswer, stage)
    return answerDiagnosis(examiner.model, utterance)
  }
  if (intent === 'repeat_request') return say(input.followUpQuestion ?? PROMPTS.askForAnswer, stage)
  return say(PROMPTS.closing, 'complete')
}

/** Code, not the model, builds the reply from the case JSON. */
function replyFromCase(viva: CaseFile, classification: Classification) {
  return replyForFindings(viva.findings, { findingIds: classification.finding_ids, notInCase: classification.not_in_case })
}

async function answerDiagnosis(model: ExaminerModel, utterance: string): Promise<TurnResult> {
  const question = await model.writeFollowUp(utterance)
  return { ...say(question, 'follow_up'), followUpQuestion: question, diagnosisAnswer: utterance }
}
