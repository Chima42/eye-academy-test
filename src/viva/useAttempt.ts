import { useCallback, useEffect, useRef, useState } from 'react'
import { getAttempt, saveAttempt, type AttemptKey } from '../lib/attempts'
import type { Attempt } from './attempt'

/** Load one attempt and save every change to Firestore. */
export function useAttempt(key: AttemptKey) {
  const { uid, attemptId } = key
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  // Callbacks read the attempt from here: state updates land after the render they were made in.
  const latest = useRef<Attempt | null>(null)

  useEffect(() => {
    getAttempt({ uid, attemptId })
      .then((loaded) => {
        // Attempts are read from the signed-in user's own path, so someone else's id is simply not found.
        if (!loaded) return setNotFound(true)
        latest.current = loaded
        setAttempt(loaded)
      })
      .catch(() => setLoadFailed(true)) // e.g. the Firestore emulator isn't running
  }, [uid, attemptId])

  const save = useCallback(
    async (next: Attempt) => {
      latest.current = next
      setAttempt(next)
      await saveAttempt({ uid, attemptId }, next)
    },
    [uid, attemptId],
  )

  return { attempt, latest, notFound, loadFailed, save }
}
