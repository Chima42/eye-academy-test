import type { TurnTiming } from './attempt'

/** `performance.now()` marks taken while the trainee's speech is turned into text. */
export interface ListeningMarks {
  /** Talk button released (or Space key-up): the timer starts here. */
  finishedAt: number
  recordingStoppedAt: number
  transcribedAt: number
  /** Deepgram's own time, from the Server-Timing header. */
  sttMs?: number
}

/** Marks taken while the examiner replies. */
export interface ReplyMarks {
  at: number
  llmMs: number
  speechRequestedAt: number
  /** Examiner audio fired 'playing': the timer stops here. */
  playingAt: number
  ttsFirstByteMs?: number
}

export function turnTiming(listening: ListeningMarks, reply: ReplyMarks): TurnTiming {
  return {
    at: reply.at,
    totalMs: reply.playingAt - listening.finishedAt,
    stopRecordingMs: listening.recordingStoppedAt - listening.finishedAt,
    sttRoundTripMs: listening.transcribedAt - listening.recordingStoppedAt,
    sttMs: listening.sttMs,
    llmMs: reply.llmMs,
    audioStartMs: reply.playingAt - reply.speechRequestedAt,
    ttsFirstByteMs: reply.ttsFirstByteMs,
  }
}
