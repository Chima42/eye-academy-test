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

/** Read a Server-Timing metric (ms) for a same-origin request the browser made. */
export function serverTiming(url: string, name: string): number | undefined {
  const entries = performance.getEntriesByName(new URL(url, location.href).href) as PerformanceResourceTiming[]
  const last = entries.at(-1)
  return last?.serverTiming?.find((t) => t.name === name)?.duration
}

export async function transcribeBlob(blob: Blob): Promise<{ transcript: string; sttMs?: number }> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  })
  const json = (await res.json()) as { transcript?: string; error?: string }
  if (!res.ok) throw new Error(json.error ?? 'Speech-to-text failed')
  return { transcript: json.transcript ?? '', sttMs: serverTiming('/api/transcribe', 'stt') }
}

let current: HTMLAudioElement | null = null

/**
 * Speak text through /api/speak. Resolves `started` when audio starts playing (the end of the
 * timed voice turn) and `ended` when it finishes. The <audio> element plays the MP3 as it streams.
 */
export function speak(text: string): { started: Promise<{ ttsFirstByteMs?: number }>; ended: Promise<void> } {
  current?.pause()
  const url = `/api/speak?text=${encodeURIComponent(text)}`
  const audio = new Audio(url)
  current = audio
  const started = new Promise<{ ttsFirstByteMs?: number }>((resolve, reject) => {
    audio.addEventListener('playing', () => resolve({ ttsFirstByteMs: serverTiming(url, 'tts_first_byte') }), { once: true })
    audio.addEventListener('error', () => reject(new Error('Audio playback failed')), { once: true })
  })
  const ended = new Promise<void>((resolve) => {
    audio.addEventListener('ended', () => resolve(), { once: true })
    audio.addEventListener('error', () => resolve(), { once: true })
    audio.addEventListener('pause', () => resolve(), { once: true })
  })
  audio.play().catch(() => {}) // errors surface through `started`
  return { started, ended }
}

export function stopSpeaking(): void {
  current?.pause()
}
