/**
 * Browser voice helpers: push-to-talk recording and streaming playback.
 */

export class Recorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  /** Ask for the mic once and keep it, so each press starts recording instantly. */
  async init(): Promise<void> {
    if (this.stream) return
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  }

  start(): void {
    if (!this.stream) throw new Error('Microphone not ready')
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data)
    this.recorder.start()
  }

  /** Stop and return the recording. */
  stop(): Promise<Blob> {
    const rec = this.recorder
    if (!rec || rec.state === 'inactive') return Promise.resolve(new Blob())
    return new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType }))
      rec.stop()
    })
  }

  dispose(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}

/** Read one metric (ms) from a Server-Timing header, e.g. "stt;dur=261". */
function serverTiming(header: string | null, name: string): number | undefined {
  const m = header?.match(new RegExp(`(?:^|,)\\s*${name};dur=([\\d.]+)`))
  return m ? Number(m[1]) : undefined
}

export async function transcribeBlob(blob: Blob): Promise<{ transcript: string; sttMs?: number }> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  })
  const json = (await res.json()) as { transcript?: string; error?: string }
  if (!res.ok) throw new Error(json.error ?? 'Speech-to-text failed')
  return { transcript: json.transcript ?? '', sttMs: serverTiming(res.headers.get('server-timing'), 'stt') }
}

let current: HTMLAudioElement | null = null

const canStream = () => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')

/**
 * Feed the MP3 into the <audio> element chunk by chunk as it arrives (Media Source Extensions).
 * A plain <audio src> buffered ~2.5 s before playing even though the first audio bytes arrived in
 * ~0.3 s; appending chunks ourselves lets playback start on the first one.
 */
function streamInto(audio: HTMLAudioElement, url: string, onHeaders: (res: Response) => void): void {
  const ms = new MediaSource()
  audio.src = URL.createObjectURL(ms)
  ms.addEventListener(
    'sourceopen',
    async () => {
      try {
        const sb = ms.addSourceBuffer('audio/mpeg')
        const res = await fetch(url)
        onHeaders(res)
        if (!res.ok || !res.body) throw new Error('Text-to-speech failed')
        const reader = res.body.getReader()
        let started = false
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await new Promise<void>((resolve) => {
            sb.addEventListener('updateend', () => resolve(), { once: true })
            sb.appendBuffer(value)
          })
          if (!started) {
            started = true
            audio.play().catch(() => {})
          }
        }
        if (ms.readyState === 'open') ms.endOfStream()
      } catch {
        audio.dispatchEvent(new Event('error'))
      }
    },
    { once: true },
  )
}

/**
 * Speak text through /api/speak. `started` resolves when audio starts playing (the end of the
 * timed voice turn); `ended` when it finishes. `ttsFirstByteMs()` is the server's measurement.
 */
export function speak(text: string): { started: Promise<void>; ended: Promise<void>; ttsFirstByteMs: () => number | undefined } {
  current?.pause()
  const url = `/api/speak?text=${encodeURIComponent(text)}`
  const audio = new Audio()
  current = audio
  let ttsHeader: string | null = null

  const started = new Promise<void>((resolve, reject) => {
    audio.addEventListener('playing', () => resolve(), { once: true })
    audio.addEventListener('error', () => reject(new Error('Audio playback failed')), { once: true })
  })
  const ended = new Promise<void>((resolve) => {
    audio.addEventListener('ended', () => resolve(), { once: true })
    audio.addEventListener('error', () => resolve(), { once: true })
    audio.addEventListener('pause', () => resolve(), { once: true })
  })

  if (canStream()) {
    streamInto(audio, url, (res) => (ttsHeader = res.headers.get('server-timing')))
  } else {
    // Fallback (e.g. browsers without MSE for MP3): let the element fetch and buffer itself.
    audio.src = url
    audio.play().catch(() => {})
  }
  return { started, ended, ttsFirstByteMs: () => serverTiming(ttsHeader, 'tts_first_byte') }
}

export function stopSpeaking(): void {
  current?.pause()
}
