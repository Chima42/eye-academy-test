import { useCallback, useEffect, useRef, useState } from 'react'
import { getAttempt, saveAttempt } from '../lib/attempts'
import { Recorder, speak, stopSpeaking, transcribeBlob } from '../lib/voice'
import { generateRevisionPoint } from '../server/revision'
import { examinerTurn } from '../server/turn'
import { mergeRevealed, type Attempt, type TranscriptEntry, type TurnTiming } from './attempt'
import { PROMPTS, type PreviousRequest } from './engine'

/** The trainee's last findings request and what it revealed, for follow-ons like "and the left?". */
function previousRequest(attempt: Attempt): PreviousRequest | undefined {
  if (attempt.stage !== 'findings') return undefined
  let index = attempt.transcript.length - 1
  while (index >= 0 && attempt.transcript[index].role !== 'trainee') index--
  if (index < 0) return undefined
  const reply = attempt.transcript[index + 1]
  return { utterance: attempt.transcript[index].text, findingIds: reply?.revealed?.map((finding) => finding.id) ?? [] }
}

const MICROPHONE_UNAVAILABLE = 'Microphone unavailable. You can type your questions instead.'

export type TurnStatus = 'not_started' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'reviewing'

export function useViva(uid: string, attemptId: string) {
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [status, setStatus] = useState<TurnStatus>('not_started')
  const [error, setError] = useState<string | null>(null)
  const [micReady, setMicReady] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
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
    getAttempt(uid, attemptId)
      .then((current) => {
        // Attempts are read from the signed-in user's own path, so someone else's id is simply not found.
        if (!current) return setNotFound(true)
        attemptRef.current = current
        setAttempt(current)
        if (current.stage === 'complete') setStatus('idle')
      })
      .catch(() => setLoadFailed(true)) // e.g. the Firestore emulator isn't running
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
    async (current: Attempt) => {
      if (current.stage !== 'complete' || current.revision) return
      setStatus('reviewing')
      try {
        const revision = await generateRevisionPoint({
          data: {
            diagnosisAnswer: current.diagnosisAnswer ?? '',
            followUpQuestion: current.followUpQuestion,
            followUpAnswer: current.followUpAnswer ?? '',
          },
        })
        await update({ ...current, revision })
      } catch {
        setError('Could not generate the revision point. Check your connection and press "Generate revision point" to try again.')
      }
    },
    [update],
  )

  /**
   * One trainee turn, from voice or the text box. `marks.finishedAt` is when the trainee finished
   * (button release / submit); voice turns also pass when recording stopped and the transcript arrived.
   */
  const handleUtterance = useCallback(
    async (
      text: string,
      source: 'voice' | 'text',
      marks: { finishedAt: number; stopped?: number; transcribed?: number; sttMs?: number },
    ) => {
      const current = attemptRef.current
      if (!current || current.stage === 'complete') return
      setStatus('thinking')
      setError(null)
      try {
        const llmStart = performance.now()
        const result = await examinerTurn({
          data: {
            stage: current.stage,
            utterance: text,
            diagnosisAnswer: current.diagnosisAnswer,
            followUpQuestion: current.followUpQuestion,
            previous: previousRequest(current),
          },
        })
        const llmMs = performance.now() - llmStart
        const now = Date.now()
        const entries: TranscriptEntry[] = []
        if (result.counted) entries.push({ role: 'trainee', text, at: now, source })
        entries.push({ role: 'examiner', text: result.spoken, at: now, revealed: result.revealed })
        const next: Attempt = {
          ...current,
          stage: result.nextStage,
          transcript: [...current.transcript, ...entries],
          revealed: mergeRevealed(current.revealed, result.revealed),
          diagnosisAnswer: result.diagnosisAnswer ?? current.diagnosisAnswer,
          followUpQuestion: result.followUpQuestion ?? current.followUpQuestion,
          followUpAnswer: current.stage === 'follow_up' && result.counted ? text : current.followUpAnswer,
        }
        // Save and speak at the same time: the trainee shouldn't wait for the database.
        const saving = update(next)
        const speakAt = performance.now()
        let playingAt = 0
        const ttsFirstByteMs = await say(result.spoken, () => (playingAt = performance.now()))
        await saving
        if (source === 'voice' && playingAt) {
          const { finishedAt, stopped, transcribed, sttMs } = marks
          const timing: TurnTiming = {
            at: now,
            totalMs: playingAt - finishedAt,
            stopRecordingMs: stopped !== undefined ? stopped - finishedAt : undefined,
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
      } catch (caught) {
        console.error(caught)
        setError('The examiner could not respond. Check your connection and try again, or type your question.')
        setStatus('idle')
      }
    },
    [say, update, reviewIfComplete],
  )

  /** Start (or resume): needs a click, so the browser allows audio and the mic. */
  const begin = useCallback(async () => {
    const current = attemptRef.current
    if (!current) return
    try {
      await recorder.current.init()
      setMicReady(true)
    } catch {
      setError(MICROPHONE_UNAVAILABLE)
    }
    // A new viva opens with the examiner reading the opening prompt. A resumed one carries on
    // silently: the last line is on screen, and "Repeat last" replays it if wanted.
    const isNew = !current.transcript.some((entry) => entry.role === 'trainee')
    if (isNew && current.stage === 'findings') await say(current.transcript[0].text)
    setStatus('idle')
    await reviewIfComplete(current)
    setStatus('idle')
  }, [say, reviewIfComplete])

  const startTalking = useCallback(() => {
    if (status !== 'idle' || !micReady) return
    try {
      recorder.current.start()
      setStatus('listening')
    } catch {
      setError(MICROPHONE_UNAVAILABLE)
    }
  }, [status, micReady])

  const stopTalking = useCallback(async () => {
    if (status !== 'listening') return
    const finishedAt = performance.now()
    setStatus('thinking')
    try {
      const blob = await recorder.current.stop()
      const stopped = performance.now()
      const { transcript, sttMs } = await transcribeBlob(blob)
      const transcribed = performance.now()
      await handleUtterance(transcript, 'voice', { finishedAt, stopped, transcribed, sttMs })
    } catch {
      setError("Speech-to-text failed. Try again, or type your question.")
      setStatus('idle')
    }
  }, [status, handleUtterance])

  const submitText = useCallback(
    (text: string) => {
      if (status !== 'idle') return
      void handleUtterance(text, 'text', { finishedAt: performance.now() })
    },
    [status, handleUtterance],
  )

  /** The "Give my diagnosis" button: a direct stage change, no model call. */
  const moveToDiagnosis = useCallback(async () => {
    const current = attemptRef.current
    if (!current || current.stage !== 'findings' || status !== 'idle') return
    const entry: TranscriptEntry = { role: 'examiner', text: PROMPTS.askForAnswer, at: Date.now() }
    await update({ ...current, stage: 'diagnosis', transcript: [...current.transcript, entry] })
    await say(PROMPTS.askForAnswer)
    setStatus('idle')
  }, [status, update, say])

  const repeatLast = useCallback(async () => {
    const last = attemptRef.current?.transcript.filter((entry) => entry.role === 'examiner').at(-1)
    if (!last || status !== 'idle') return
    await say(last.text)
    setStatus('idle')
  }, [say, status])

  /** Retry the revision point after a failure. No mic needed, so it doesn't go through `begin`. */
  const retryRevision = useCallback(async () => {
    const current = attemptRef.current
    if (!current) return
    setError(null)
    await reviewIfComplete(current)
    setStatus('idle')
  }, [reviewIfComplete])

  return { attempt, notFound, loadFailed, retryRevision, status, error, micReady, begin, startTalking, stopTalking, submitText, moveToDiagnosis, repeatLast }
}
