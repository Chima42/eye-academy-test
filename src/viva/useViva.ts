import { useCallback, useEffect, useRef, useState } from 'react'
import { getAttempt, saveAttempt } from '../lib/attempts'
import { Recorder, speak, stopSpeaking, transcribeBlob } from '../lib/voice'
import { generateRevisionPoint } from '../server/revision'
import { examinerTurn } from '../server/turn'
import { mergeRevealed, type Attempt, type TranscriptEntry, type TurnTiming } from './attempt'
import { PROMPTS, type PreviousRequest } from './engine'

/** The trainee's last findings request and what it revealed, for follow-ons like "and the left?". */
function previousRequest(a: Attempt): PreviousRequest | undefined {
  if (a.stage !== 'findings') return undefined
  let i = a.transcript.length - 1
  while (i >= 0 && a.transcript[i].role !== 'trainee') i--
  if (i < 0) return undefined
  const reply = a.transcript[i + 1]
  return { utterance: a.transcript[i].text, findingIds: reply?.revealed?.map((f) => f.id) ?? [] }
}

/** Whose turn it is. Drives the status indicator and enables/disables the mic. */
export type TurnStatus = 'not_started' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'reviewing'

export function useViva(uid: string, attemptId: string) {
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [status, setStatus] = useState<TurnStatus>('not_started')
  const [error, setError] = useState<string | null>(null)
  const [micReady, setMicReady] = useState(false)
  const recorder = useRef(new Recorder())
  const attemptRef = useRef<Attempt | null>(null)

  const update = useCallback(
    async (next: Attempt) => {
      attemptRef.current = next
      setAttempt(next)
      await saveAttempt(uid, attemptId, next)
    },
    [uid, attemptId],
  )

  useEffect(() => {
    getAttempt(uid, attemptId).then((a) => {
      attemptRef.current = a
      setAttempt(a)
      if (a?.stage === 'complete') setStatus('idle')
    })
    const rec = recorder.current
    return () => {
      rec.dispose()
      stopSpeaking()
    }
  }, [uid, attemptId])

  /**
   * Speak and wait until the audio finishes. `onStarted` fires when audio starts playing (the end
   * of a timed turn). Returns the server's text-to-speech time to first byte, if the browser recorded it.
   */
  const say = useCallback(async (text: string, onStarted?: () => void): Promise<number | undefined> => {
    setStatus('speaking')
    try {
      const { started, ended, ttsFirstByteMs } = speak(text)
      await started
      onStarted?.()
      await ended
      return ttsFirstByteMs()
    } catch {
      setError('Could not play the examiner audio. The reply is shown on screen.')
      return undefined
    }
  }, [])

  const reviewIfComplete = useCallback(
    async (a: Attempt) => {
      if (a.stage !== 'complete' || a.revision) return
      setStatus('reviewing')
      try {
        const revision = await generateRevisionPoint({
          data: {
            diagnosisAnswer: a.diagnosisAnswer ?? '',
            followUpQuestion: a.followUpQuestion,
            followUpAnswer: a.followUpAnswer ?? '',
          },
        })
        await update({ ...a, revision })
      } catch {
        setError('Could not generate the revision point. Try again from the attempts list.')
      }
    },
    [update],
  )

  /**
   * One trainee turn, from voice or the text box. `marks.t0` is when the trainee finished
   * (button release / submit); voice turns also pass when recording stopped and the transcript arrived.
   */
  const handleUtterance = useCallback(
    async (
      text: string,
      source: 'voice' | 'text',
      marks: { t0: number; stopped?: number; transcribed?: number; sttMs?: number },
    ) => {
      const a = attemptRef.current
      if (!a || a.stage === 'complete') return
      setStatus('thinking')
      setError(null)
      try {
        const llmStart = performance.now()
        const result = await examinerTurn({
          data: { stage: a.stage, utterance: text, diagnosisAnswer: a.diagnosisAnswer, previous: previousRequest(a) },
        })
        const llmMs = performance.now() - llmStart
        const now = Date.now()
        const entries: TranscriptEntry[] = []
        if (result.counted) entries.push({ role: 'trainee', text, at: now, source })
        entries.push({ role: 'examiner', text: result.spoken, at: now, revealed: result.revealed })
        const next: Attempt = {
          ...a,
          stage: result.nextStage,
          transcript: [...a.transcript, ...entries],
          revealed: mergeRevealed(a.revealed, result.revealed),
          diagnosisAnswer: a.stage === 'diagnosis' && result.counted ? text : a.diagnosisAnswer,
          followUpQuestion: result.followUpQuestion ?? a.followUpQuestion,
          followUpAnswer: a.stage === 'follow_up' && result.counted ? text : a.followUpAnswer,
        }
        // Save and speak at the same time: the trainee shouldn't wait for the database.
        const saving = update(next)
        const speakAt = performance.now()
        let playingAt = 0
        const ttsFirstByteMs = await say(result.spoken, () => (playingAt = performance.now()))
        await saving
        if (source === 'voice' && playingAt) {
          const { t0, stopped, transcribed, sttMs } = marks
          const timing: TurnTiming = {
            at: now,
            totalMs: playingAt - t0,
            stopRecordingMs: stopped !== undefined ? stopped - t0 : undefined,
            sttRoundTripMs: stopped !== undefined && transcribed !== undefined ? transcribed - stopped : undefined,
            sttMs,
            llmMs,
            audioStartMs: playingAt - speakAt,
            ttsFirstByteMs,
          }
          const latest = attemptRef.current ?? next
          await update({ ...latest, timings: [...latest.timings, timing] })
        }
        setStatus('idle')
        await reviewIfComplete(attemptRef.current ?? next)
        setStatus('idle')
      } catch (err) {
        console.error(err)
        setError('The examiner could not respond. Check your connection and try again, or type your question.')
        setStatus('idle')
      }
    },
    [say, update, reviewIfComplete],
  )

  /** Start (or resume): needs a click, so the browser allows audio and the mic. */
  const begin = useCallback(async () => {
    const a = attemptRef.current
    if (!a) return
    try {
      await recorder.current.init()
      setMicReady(true)
    } catch {
      setError('Microphone unavailable. You can type your questions instead.')
    }
    // A new viva opens with the examiner reading the opening prompt. A resumed one carries on
    // silently: the last line is on screen, and "Repeat last" replays it if wanted.
    const isNew = !a.transcript.some((e) => e.role === 'trainee')
    if (isNew && a.stage === 'findings') await say(a.transcript[0].text)
    setStatus('idle')
    await reviewIfComplete(a)
    setStatus('idle')
  }, [say, reviewIfComplete])

  const startTalking = useCallback(() => {
    if (status !== 'idle' || !micReady) return
    try {
      recorder.current.start()
      setStatus('listening')
    } catch {
      setError('Microphone unavailable. You can type your questions instead.')
    }
  }, [status, micReady])

  const stopTalking = useCallback(async () => {
    if (status !== 'listening') return
    const t0 = performance.now()
    setStatus('thinking')
    try {
      const blob = await recorder.current.stop()
      const stopped = performance.now()
      const { transcript, sttMs } = await transcribeBlob(blob)
      const transcribed = performance.now()
      await handleUtterance(transcript, 'voice', { t0, stopped, transcribed, sttMs })
    } catch {
      setError("Speech-to-text failed. Try again, or type your question.")
      setStatus('idle')
    }
  }, [status, handleUtterance])

  const submitText = useCallback(
    (text: string) => {
      if (status !== 'idle') return
      void handleUtterance(text, 'text', { t0: performance.now() })
    },
    [status, handleUtterance],
  )

  /** The "Give my diagnosis" button: a direct stage change, no model call. */
  const moveToDiagnosis = useCallback(async () => {
    const a = attemptRef.current
    if (!a || a.stage !== 'findings' || status !== 'idle') return
    const entry: TranscriptEntry = { role: 'examiner', text: PROMPTS.askForAnswer, at: Date.now() }
    await update({ ...a, stage: 'diagnosis', transcript: [...a.transcript, entry] })
    await say(PROMPTS.askForAnswer)
    setStatus('idle')
  }, [status, update, say])

  const repeatLast = useCallback(async () => {
    const last = attemptRef.current?.transcript.filter((e) => e.role === 'examiner').at(-1)
    if (!last || status !== 'idle') return
    await say(last.text)
    setStatus('idle')
  }, [say, status])

  return { attempt, status, error, micReady, begin, startTalking, stopTalking, submitText, moveToDiagnosis, repeatLast }
}
