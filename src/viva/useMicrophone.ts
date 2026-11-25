import { useCallback, useEffect, useRef, useState } from 'react'
import { Recorder } from '../lib/voice'

/** Push-to-talk recording. `enable` needs a click, so the browser shows its permission prompt. */
export function useMicrophone() {
  const recorder = useRef(new Recorder())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const current = recorder.current
    return () => current.dispose()
  }, [])

  const enable = useCallback(async () => {
    await recorder.current.init()
    setReady(true)
  }, [])
  const start = useCallback(() => recorder.current.start(), [])
  const stop = useCallback(() => recorder.current.stop(), [])

  return { ready, enable, start, stop }
}
