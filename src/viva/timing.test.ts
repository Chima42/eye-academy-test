import { describe, expect, it } from 'vitest'
import { turnTiming } from './timing'

const listening = { finishedAt: 1000, recordingStoppedAt: 1010, transcribedAt: 1750, sttMs: 400 }
const reply = { at: 1_700_000_000_000, llmMs: 1100, speechRequestedAt: 2850, playingAt: 3250, ttsFirstByteMs: 280 }

describe('turnTiming', () => {
  it('times the turn from button release to examiner audio playing', () => {
    expect(turnTiming(listening, reply).totalMs).toBe(2250)
  })

  it('splits the turn into recording, transcription and audio start', () => {
    expect(turnTiming(listening, reply)).toMatchObject({ stopRecordingMs: 10, sttRoundTripMs: 740, audioStartMs: 400 })
  })

  it('keeps the server-side measurements as reported', () => {
    expect(turnTiming(listening, reply)).toMatchObject({ sttMs: 400, llmMs: 1100, ttsFirstByteMs: 280, at: reply.at })
  })
})
