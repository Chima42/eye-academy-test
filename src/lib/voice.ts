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
    this.recorder.ondataavailable = (event) => event.data.size > 0 && this.chunks.push(event.data)
    this.recorder.start()
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(new Blob())
    return new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }))
      recorder.stop()
    })
  }

  dispose(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }
}

function serverTiming(header: string | null, name: string): number | undefined {
  const match = header?.match(new RegExp(`(?:^|,)\\s*${name};dur=([\\d.]+)`))
  return match ? Number(match[1]) : undefined
}

export async function transcribeBlob(blob: Blob): Promise<{ transcript: string; sttMs?: number }> {
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  })
  const json = (await response.json()) as { transcript?: string; error?: string }
  if (!response.ok) throw new Error(json.error ?? 'Speech-to-text failed')
  return { transcript: json.transcript ?? '', sttMs: serverTiming(response.headers.get('server-timing'), 'stt') }
}

let currentAudio: HTMLAudioElement | null = null

const canStream = () => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')

/**
 * Feed the MP3 into the <audio> element chunk by chunk as it arrives (Media Source Extensions).
 * A plain <audio src> buffered ~2.5 s before playing even though the first audio bytes arrived in
 * ~0.3 s; appending chunks ourselves lets playback start on the first one.
 */
function streamInto(audio: HTMLAudioElement, url: string, onHeaders: (response: Response) => void): void {
  const mediaSource = new MediaSource()
  audio.src = URL.createObjectURL(mediaSource)
  mediaSource.addEventListener(
    'sourceopen',
    async () => {
      try {
        const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg')
        const response = await fetch(url)
        onHeaders(response)
        if (!response.ok || !response.body) throw new Error('Text-to-speech failed')
        const reader = response.body.getReader()
        let started = false
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await new Promise<void>((resolve) => {
            sourceBuffer.addEventListener('updateend', () => resolve(), { once: true })
            sourceBuffer.appendBuffer(value)
          })
          if (!started) {
            started = true
            audio.play().catch(() => {})
          }
        }
        if (mediaSource.readyState === 'open') mediaSource.endOfStream()
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
  currentAudio?.pause()
  const url = `/api/speak?text=${encodeURIComponent(text)}`
  const audio = new Audio()
  currentAudio = audio
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
    streamInto(audio, url, (response) => (ttsHeader = response.headers.get('server-timing')))
  } else {
    // Fallback (e.g. browsers without MSE for MP3): let the element fetch and buffer itself.
    audio.src = url
    audio.play().catch(() => {})
  }
  return { started, ended, ttsFirstByteMs: () => serverTiming(ttsHeader, 'tts_first_byte') }
}

export function stopSpeaking(): void {
  currentAudio?.pause()
}
