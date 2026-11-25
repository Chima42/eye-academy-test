import { z } from 'zod'
import type { RevealedFinding } from '../case/types'
import type { PreviousRequest, Stage, TurnResult } from './engine'

/** The trainee's answers the revision point is based on. */
export const RevisionInputSchema = z.object({
  diagnosisAnswer: z.string().max(4000),
  followUpQuestion: z.string().max(1000).optional(),
  followUpAnswer: z.string().max(4000),
})
export type RevisionInput = z.infer<typeof RevisionInputSchema>

export interface TranscriptEntry {
  role: 'examiner' | 'trainee'
  text: string
  at: number
  source?: 'voice' | 'text'
  revealed?: RevealedFinding[]
}

/**
 * One timed voice turn. totalMs is the headline number; the rest split it up:
 *   totalMs ~= stopRecordingMs + sttRoundTripMs + llmMs + audioStartMs
 * sttMs and ttsFirstByteMs are server-side (Server-Timing) parts of sttRoundTripMs and audioStartMs.
 */
export interface TurnTiming {
  at: number
  /** Button release -> examiner audio 'playing'. The number reported in the write-up. */
  totalMs: number
  stopRecordingMs?: number
  /** Blob ready -> transcript back in the browser (upload + Deepgram + response). */
  sttRoundTripMs?: number
  sttMs?: number
  /** Examiner reply round trip (server function, including Claude). */
  llmMs?: number
  /** Audio requested -> 'playing' (text-to-speech first byte + browser buffering). */
  audioStartMs?: number
  ttsFirstByteMs?: number
}

export interface RetrievedPassage {
  chunkId: string
  pages: number[]
  section: string
  score: number
}

export type RevisionPoint =
  | {
      status: 'supported'
      gap: string
      point: string
      /** The note's own text for the quote. */
      excerpt: string
      page: number
      /** Every page it is printed on (two when a quote runs over a page break). */
      pages?: number[]
      /** The retrieved passage the excerpt was verified against. */
      chunkId: string
      retrieved: RetrievedPassage[]
    }
  | {
      status: 'unsupported'
      gap: string
      reason: string
      retrieved: RetrievedPassage[]
    }

export interface Attempt {
  caseId: string
  createdAt: number
  updatedAt: number
  stage: Stage
  transcript: TranscriptEntry[]
  revealed: RevealedFinding[]
  diagnosisAnswer?: string
  followUpQuestion?: string
  followUpAnswer?: string
  revision?: RevisionPoint
  timings: TurnTiming[]
}

export function citedPages(revision: Extract<RevisionPoint, { status: 'supported' }>): string {
  const pages = revision.pages ?? [revision.page]
  return pages.length > 1 ? `pages ${pages.join('–')}` : `page ${pages[0]}`
}

export const needsRevisionPoint = (attempt: Attempt) => attempt.stage === 'complete' && !attempt.revision

export function revisionInputOf(attempt: Attempt): RevisionInput {
  return {
    diagnosisAnswer: attempt.diagnosisAnswer ?? '',
    followUpQuestion: attempt.followUpQuestion,
    followUpAnswer: attempt.followUpAnswer ?? '',
  }
}

/** Add newly revealed findings, keeping the first snapshot of each. */
export function mergeRevealed(existing: RevealedFinding[], added: RevealedFinding[]): RevealedFinding[] {
  const seen = new Set(existing.map((f) => f.id))
  return [...existing, ...added.filter((f) => !seen.has(f.id))]
}

/** The trainee's last findings request and what it revealed, for follow-ons like "and the left?". */
export function previousRequest(attempt: Attempt): PreviousRequest | undefined {
  if (attempt.stage !== 'findings') return undefined
  let lastTrainee = attempt.transcript.length - 1
  while (lastTrainee >= 0 && attempt.transcript[lastTrainee].role !== 'trainee') lastTrainee--
  if (lastTrainee < 0) return undefined
  const reply = attempt.transcript[lastTrainee + 1]
  return {
    utterance: attempt.transcript[lastTrainee].text,
    findingIds: reply?.revealed?.map((finding) => finding.id) ?? [],
  }
}

export interface TraineeUtterance {
  text: string
  source: 'voice' | 'text'
}

export interface CompletedTurn {
  utterance: TraineeUtterance
  result: TurnResult
  at: number
}

/** The attempt after one exchange: transcript, revealed findings, stage and answers. */
export function withTurn(attempt: Attempt, turn: CompletedTurn): Attempt {
  const { utterance, result, at } = turn
  const entries: TranscriptEntry[] = []
  if (result.counted) entries.push({ role: 'trainee', text: utterance.text, at, source: utterance.source })
  entries.push({ role: 'examiner', text: result.spoken, at, revealed: result.revealed })
  return {
    ...attempt,
    stage: result.nextStage,
    transcript: [...attempt.transcript, ...entries],
    revealed: mergeRevealed(attempt.revealed, result.revealed),
    diagnosisAnswer: result.diagnosisAnswer ?? attempt.diagnosisAnswer,
    followUpQuestion: result.followUpQuestion ?? attempt.followUpQuestion,
    followUpAnswer: attempt.stage === 'follow_up' && result.counted ? utterance.text : attempt.followUpAnswer,
  }
}
