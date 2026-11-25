import type { RevealedFinding } from '../case/types'
import type { Stage } from './engine'

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

/** Add newly revealed findings, keeping the first snapshot of each. */
export function mergeRevealed(existing: RevealedFinding[], added: RevealedFinding[]): RevealedFinding[] {
  const seen = new Set(existing.map((f) => f.id))
  return [...existing, ...added.filter((f) => !seen.has(f.id))]
}
