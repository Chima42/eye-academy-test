import { useCallback, useEffect, useRef, useState } from 'react'
import { getAttempt, saveAttempt } from '../lib/attempts'
import { Recorder, speak, stopSpeaking, transcribeBlob } from '../lib/voice'
import { generateRevisionPoint } from '../server/revision'
import { examinerTurn } from '../server/turn'
import { mergeRevealed, type Attempt, type TranscriptEntry } from './attempt'
import { PROMPTS } from './engine'

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

  /** Speak, and wait until the audio finishes. Returns when audio *started*, for timing. */
  const say = useCallback(async (text: string, onStarted?: (ttsFirstByteMs?: number) => void) => {
    setStatus('speaking')
    try {
      const { started, ended } = speak(text)
      const { ttsFirstByteMs } = await started
      onStarted?.(ttsFirstByteMs)
      await ended
    } catch {
      setError('Could not play the examiner audio. The reply is shown on screen.')
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

  /** One trainee turn, from voice or the text box. `t0` is when the trainee finished (button release / submit). */
  const handleUtterance = useCallback(
    async (text: string, source: 'voice' | 'text', t0: number, sttMs?: number) => {
      const a = attemptRef.current
      if (!a || a.stage === 'complete') return
      setStatus('thinking')
      setError(null)
      try {
        const llmStart = performance.now()
        const result = await examinerTurn({
          data: { stage: a.stage, utterance: text, diagnosisAnswer: a.diagnosisAnswer },
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
        await update(next)
        await say(result.spoken, (ttsFirstByteMs) => {
          const timing = { at: now, totalMs: performance.now() - t0, sttMs, llmMs, ttsFirstByteMs }
          if (source === 'voice') {
            const timed = { ...next, timings: [...next.timings, timing] }
            attemptRef.current = timed
            setAttempt(timed)
            void saveAttempt(uid, attemptId, timed)
          }
        })
        setStatus('idle')
        await reviewIfComplete(attemptRef.current ?? next)
        setStatus('idle')
      } catch (err) {
        console.error(err)
        setError('The examiner could not respond. Check your connection and try again, or type your question.')
        setStatus('idle')
      }
    },
    [say, update, reviewIfComplete, uid, attemptId],
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
      const { transcript, sttMs } = await transcribeBlob(blob)
      await handleUtterance(transcript, 'voice', t0, sttMs)
    } catch {
      setError("Speech-to-text failed. Try again, or type your question.")
      setStatus('idle')
    }
  }, [status, handleUtterance])

  const submitText = useCallback(
    (text: string) => {
      if (status !== 'idle') return
      void handleUtterance(text, 'text', performance.now())
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
