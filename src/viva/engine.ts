import { replyForFindings } from '../case/format'
import type { CaseFile, RevealedFinding } from '../case/types'

/**
 * Viva stages:
 *   findings   -> trainee asks for findings, any number of turns
 *   diagnosis  -> trainee gives diagnosis + immediate management (one turn)
 *   follow_up  -> examiner has asked one follow-up; trainee answers (one turn)
 *   complete   -> viva over; the revision point is generated
 */
export type Stage = 'findings' | 'diagnosis' | 'follow_up' | 'complete'

export type Intent = 'finding_request' | 'ready_to_answer' | 'other'

export interface Classification {
  intent: Intent
  finding_ids: string[]
}

/** The trainee's previous findings request, so "what about the left eye?" can be understood. */
export interface PreviousRequest {
  utterance: string
  findingIds: string[]
}

/** The LLM calls the engine needs. Injected so tests can use fakes or the real model. */
export interface ExaminerModel {
  classify(utterance: string, previous?: PreviousRequest): Promise<Classification>
  writeFollowUp(diagnosisAnswer: string): Promise<string>
}

export interface TurnInput {
  stage: Stage
  utterance: string
  /** The trainee's diagnosis answer; needed when moving into the follow-up. */
  diagnosisAnswer?: string
  previous?: PreviousRequest
}

export interface TurnResult {
  /** What the examiner says (and shows). */
  spoken: string
  /** Findings revealed this turn, as shown on screen. */
  revealed: RevealedFinding[]
  nextStage: Stage
  /** False when nothing usable was heard: the turn doesn't count. */
  counted: boolean
  /** Set when this turn produced the follow-up question. */
  followUpQuestion?: string
}

export const PROMPTS = {
  didntCatch: "Sorry, I didn't catch that. Could you say it again?",
  askForAnswer: "Go ahead. What's your diagnosis, and what's your immediate management?",
  steer: "You can ask me for any examination findings, or tell me you're ready to give your diagnosis.",
  closing: "Thank you, that's the end of the viva. I'll put together a revision point for you.",
}

/** Too short to be a real request: silence, a cough, a stray "um". */
function isEmpty(utterance: string): boolean {
  return utterance.replace(/[^\p{L}\p{N}]/gu, '').length < 2
}

export async function runTurn(viva: CaseFile, input: TurnInput, model: ExaminerModel): Promise<TurnResult> {
  const { stage, utterance } = input
  if (isEmpty(utterance)) {
    return { spoken: PROMPTS.didntCatch, revealed: [], nextStage: stage, counted: false }
  }

  switch (stage) {
    case 'findings': {
      const { intent, finding_ids } = await model.classify(utterance, input.previous)
      if (intent === 'ready_to_answer') {
        return { spoken: PROMPTS.askForAnswer, revealed: [], nextStage: 'diagnosis', counted: true }
      }
      if (intent === 'other' && finding_ids.length === 0) {
        return { spoken: PROMPTS.steer, revealed: [], nextStage: 'findings', counted: true }
      }
      // Code, not the model, builds the reply from the case JSON.
      const reply = replyForFindings(viva.findings, finding_ids)
      return { spoken: reply.spoken, revealed: reply.revealed, nextStage: 'findings', counted: true }
    }
    case 'diagnosis': {
      const question = await model.writeFollowUp(utterance)
      return { spoken: question, revealed: [], nextStage: 'follow_up', counted: true, followUpQuestion: question }
    }
    case 'follow_up':
      return { spoken: PROMPTS.closing, revealed: [], nextStage: 'complete', counted: true }
    case 'complete':
      return { spoken: PROMPTS.closing, revealed: [], nextStage: 'complete', counted: false }
  }
}
