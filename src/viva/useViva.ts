import { useCallback, useEffect, useState } from 'react'
import type { AttemptKey } from '../lib/attempts'
import { speak, stopSpeaking, transcribeBlob, untilSpoken, type Speech } from '../lib/voice'
import { generateRevisionPoint } from '../server/revision'
import { examinerTurn } from '../server/turn'
import { needsRevisionPoint, previousRequest, revisionInputOf, withTurn, type Attempt, type TraineeUtterance } from './attempt'
import { PROMPTS } from './engine'
import { turnTiming, type ListeningMarks } from './timing'
import { useAttempt } from './useAttempt'
import { useMicrophone } from './useMicrophone'

const MESSAGES = {
  microphoneUnavailable: 'Microphone unavailable. You can type your questions instead.',
  audioFailed: 'Could not play the examiner audio. The reply is shown on screen.',
  examinerFailed: 'The examiner could not respond. Check your connection and try again, or type your question.',
  speechToTextFailed: 'Speech-to-text failed. Try again, or type your question.',
  revisionFailed: 'Could not generate the revision point. Check your connection and press "Generate revision point" to try again.',
}

export type TurnStatus = 'not_started' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'reviewing'

/** Turn-taking for one viva: who speaks when, and what each turn does to the attempt. */
export function useViva(key: AttemptKey) {
  const store = useAttempt(key)
  const { ready: micReady, enable: enableMicrophone, start: startRecording, stop: stopRecording } = useMicrophone()
  const [status, setStatus] = useState<TurnStatus>('not_started')
  const [error, setError] = useState<string | null>(null)
  const { latest, save } = store

  useEffect(() => stopSpeaking, [])
  useEffect(() => {
    if (status === 'not_started' && store.attempt?.stage === 'complete') setStatus('idle')
  }, [status, store.attempt])

  /** Play one examiner line to the end. Returns when playback started, or null if the audio failed. */
  const sayAloud = useCallback(async (speech: Speech) => {
    setStatus('speaking')
    const spoken = await untilSpoken(speech)
    if (!spoken) setError(MESSAGES.audioFailed)
    return spoken
  }, [])

  const addRevisionPointIfDue = useCallback(
    async (attempt: Attempt) => {
      if (!needsRevisionPoint(attempt)) return
      setStatus('reviewing')
      try {
        const revision = await generateRevisionPoint({ data: revisionInputOf(attempt) })
        await save({ ...attempt, revision })
      } catch {
        setError(MESSAGES.revisionFailed)
      }
    },
    [save],
  )

  /** One trainee turn. Voice turns pass their listening marks and are timed; typed turns aren't. */
  const takeTurn = useCallback(
    async (utterance: TraineeUtterance, listening?: ListeningMarks) => {
      const current = latest.current
      if (!current || current.stage === 'complete') return
      setStatus('thinking')
      setError(null)
      try {
        const replyRequestedAt = performance.now()
        const result = await examinerTurn({
          data: {
            stage: current.stage,
            utterance: utterance.text,
            diagnosisAnswer: current.diagnosisAnswer,
            followUpQuestion: current.followUpQuestion,
            previous: previousRequest(current),
          },
        })
        const llmMs = performance.now() - replyRequestedAt
        const at = Date.now()
        // Save and speak at the same time: the trainee shouldn't wait for the database.
        const saving = save(withTurn(current, { utterance, result, at }))
        const speechRequestedAt = performance.now()
        const speech = speak(result.spoken)
        const spoken = await sayAloud(speech)
        await saving
        if (listening && spoken) {
          const timing = turnTiming(listening, { at, llmMs, speechRequestedAt, playingAt: spoken.playingAt, ttsFirstByteMs: speech.ttsFirstByteMs() })
          const saved = latest.current!
          await save({ ...saved, timings: [...saved.timings, timing] })
        }
        setStatus('idle')
        await addRevisionPointIfDue(latest.current!)
      } catch (caught) {
        console.error(caught)
        setError(MESSAGES.examinerFailed)
      }
      setStatus('idle')
    },
    [latest, save, sayAloud, addRevisionPointIfDue],
  )

  /** Start (or resume): needs a click, so the browser allows audio and the mic. */
  const begin = useCallback(async () => {
    const current = latest.current
    if (!current) return
    try {
      await enableMicrophone()
    } catch {
      setError(MESSAGES.microphoneUnavailable)
    }
    // A new viva opens with the examiner reading the opening prompt. A resumed one carries on
    // silently: the last line is on screen, and "Repeat last" replays it if wanted.
    const isNew = !current.transcript.some((entry) => entry.role === 'trainee')
    if (isNew && current.stage === 'findings') await sayAloud(speak(current.transcript[0].text))
    setStatus('idle')
    await addRevisionPointIfDue(current)
    setStatus('idle')
  }, [latest, enableMicrophone, sayAloud, addRevisionPointIfDue])

  const startTalking = useCallback(() => {
    if (status !== 'idle' || !micReady) return
    try {
      startRecording()
      setStatus('listening')
    } catch {
      setError(MESSAGES.microphoneUnavailable)
    }
  }, [status, micReady, startRecording])

  const stopTalking = useCallback(async () => {
    if (status !== 'listening') return
    const finishedAt = performance.now()
    setStatus('thinking')
    try {
      const recording = await stopRecording()
      const recordingStoppedAt = performance.now()
      const { transcript, sttMs } = await transcribeBlob(recording)
      const transcribedAt = performance.now()
      await takeTurn({ text: transcript, source: 'voice' }, { finishedAt, recordingStoppedAt, transcribedAt, sttMs })
    } catch {
      setError(MESSAGES.speechToTextFailed)
      setStatus('idle')
    }
  }, [status, stopRecording, takeTurn])

  const submitText = useCallback(
    (text: string) => {
      if (status === 'idle') void takeTurn({ text, source: 'text' })
    },
    [status, takeTurn],
  )

  /** The "Give my diagnosis" button: a direct stage change, no model call. */
  const moveToDiagnosis = useCallback(async () => {
    const current = latest.current
    if (!current || current.stage !== 'findings' || status !== 'idle') return
    const prompt = { role: 'examiner' as const, text: PROMPTS.askForAnswer, at: Date.now() }
    await save({ ...current, stage: 'diagnosis', transcript: [...current.transcript, prompt] })
    await sayAloud(speak(PROMPTS.askForAnswer))
    setStatus('idle')
  }, [latest, status, save, sayAloud])

  const repeatLast = useCallback(async () => {
    const last = latest.current?.transcript.filter((entry) => entry.role === 'examiner').at(-1)
    if (!last || status !== 'idle') return
    await sayAloud(speak(last.text))
    setStatus('idle')
  }, [latest, status, sayAloud])

  /** Retry the revision point after a failure. No mic needed, so it doesn't go through `begin`. */
  const retryRevision = useCallback(async () => {
    const current = latest.current
    if (!current) return
    setError(null)
    await addRevisionPointIfDue(current)
    setStatus('idle')
  }, [latest, addRevisionPointIfDue])

  return {
    attempt: store.attempt,
    notFound: store.notFound,
    loadFailed: store.loadFailed,
    status,
    error,
    micReady,
    begin,
    startTalking,
    stopTalking,
    submitText,
    moveToDiagnosis,
    repeatLast,
    retryRevision,
  }
}
