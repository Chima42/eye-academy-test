import { replyForFindings } from '../case/format'
import type { CaseFile, RevealedFinding } from '../case/types'

export type Stage = 'findings' | 'diagnosis' | 'follow_up' | 'complete'

export type Intent = 'finding_request' | 'too_broad' | 'ready_to_answer' | 'gives_answer' | 'repeat_request' | 'other'

export interface Classification {
  intent: Intent
  finding_ids: string[]
  not_in_case: string[]
}

/** The trainee's previous findings request, so "what about the left eye?" can be understood. */
export interface PreviousRequest {
  utterance: string
  findingIds: string[]
}

export interface ClassifyContext {
  stage: Stage
  previous?: PreviousRequest
}

/** The LLM calls the engine needs. Injected so tests can use fakes or the real model. */
export interface ExaminerModel {
  classify(utterance: string, context: ClassifyContext): Promise<Classification>
  writeFollowUp(diagnosisAnswer: string): Promise<string>
}

export interface TurnInput {
  stage: Stage
  utterance: string
  diagnosisAnswer?: string
  /** The follow-up already asked, so it can be repeated on request. */
  followUpQuestion?: string
  previous?: PreviousRequest
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

export async function runTurn(viva: CaseFile, input: TurnInput, model: ExaminerModel): Promise<TurnResult> {
  const { stage, utterance } = input
  if (isTooShortToCount(utterance)) {
    return { spoken: PROMPTS.didntCatch, revealed: [], nextStage: stage, counted: false }
  }
  if (stage === 'complete') {
    return { spoken: PROMPTS.closing, revealed: [], nextStage: 'complete', counted: false }
  }

  const classification = await model.classify(utterance, { stage, previous: input.previous })
  const { intent } = classification
  const stay = (spoken: string): TurnResult => ({ spoken, revealed: [], nextStage: stage, counted: true })

  if (intent === 'finding_request') return findingsReply(viva, classification, stage)

  if (stage === 'findings') {
    if (intent === 'ready_to_answer') {
      return { spoken: PROMPTS.askForAnswer, revealed: [], nextStage: 'diagnosis', counted: true }
    }
    // They gave the diagnosis without announcing it first: take it as their answer, don't ask again.
    if (intent === 'gives_answer') return answerDiagnosis(utterance, model)
    // "Is there anything wrong with the left eye?" would reveal the whole examination at once;
    // asking for findings one by one is the skill being tested, so ask which examination.
    if (intent === 'too_broad') return stay(PROMPTS.tooBroad)
    if (classification.finding_ids.length > 0) return findingsReply(viva, classification, stage)
    return stay(PROMPTS.steer)
  }

  // Answer stages: "can you repeat the question?" is not an answer.
  if (stage === 'diagnosis') {
    if (intent === 'repeat_request') return stay(PROMPTS.askForAnswer)
    return answerDiagnosis(utterance, model)
  }
  if (intent === 'repeat_request') return stay(input.followUpQuestion ?? PROMPTS.askForAnswer)
  return { spoken: PROMPTS.closing, revealed: [], nextStage: 'complete', counted: true }
}

/** Code, not the model, builds the reply from the case JSON. */
function findingsReply(viva: CaseFile, classification: Classification, stage: Stage): TurnResult {
  const reply = replyForFindings(viva.findings, classification.finding_ids, classification.not_in_case)
  return { spoken: reply.spoken, revealed: reply.revealed, nextStage: stage, counted: true }
}

async function answerDiagnosis(utterance: string, model: ExaminerModel): Promise<TurnResult> {
  const question = await model.writeFollowUp(utterance)
  return {
    spoken: question,
    revealed: [],
    nextStage: 'follow_up',
    counted: true,
    followUpQuestion: question,
    diagnosisAnswer: utterance,
  }
}
