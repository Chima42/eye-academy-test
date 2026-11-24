import type { RevealedFinding } from '../case/types'
import type { Stage } from './engine'

export interface TranscriptEntry {
  role: 'examiner' | 'trainee'
  text: string
  at: number
  /** Trainee turns: whether the text came from speech-to-text or the text box. */
  source?: 'voice' | 'text'
  /** Examiner turns: findings revealed in this reply. */
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
  /** Release -> recording blob ready. */
  stopRecordingMs?: number
  /** Blob ready -> transcript back in the browser (upload + Deepgram + response). */
  sttRoundTripMs?: number
  /** Deepgram speech-to-text time, measured on the server. */
  sttMs?: number
  /** Examiner reply round trip (server function, including Claude). */
  llmMs?: number
  /** Audio requested -> 'playing' (text-to-speech first byte + browser buffering). */
  audioStartMs?: number
  /** Deepgram text-to-speech time to first byte, measured on the server. */
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
      excerpt: string
      page: number
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
  /** Every finding revealed so far, latest first-seen order, as it was shown. */
  revealed: RevealedFinding[]
  diagnosisAnswer?: string
  followUpQuestion?: string
  followUpAnswer?: string
  revision?: RevisionPoint
  timings: TurnTiming[]
}

/** Add newly revealed findings, keeping the first snapshot of each. */
export function mergeRevealed(existing: RevealedFinding[], added: RevealedFinding[]): RevealedFinding[] {
  const seen = new Set(existing.map((f) => f.id))
  return [...existing, ...added.filter((f) => !seen.has(f.id))]
}
