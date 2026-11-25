import type { CaseFile } from '../case/types'

/**
 * Deepgram: nova-3 for speech-to-text, aura-2 for text-to-speech.
 * Called over REST with fetch (no SDK): two endpoints, nothing else needed.
 */
const API = 'https://api.deepgram.com/v1'
const STT_MODEL = 'nova-3'
const TTS_MODEL = process.env.DEEPGRAM_VOICE ?? 'aura-2-thalia-en'

function apiKey(): string {
  const value = process.env.DEEPGRAM_API_KEY
  if (!value) throw new Error('DEEPGRAM_API_KEY is not set (add it to .env.local)')
  return value
}

/**
 * Terms trainees say that aren't finding labels, picked by hand: drugs, procedures and terms from the
 * reference note and case file, plus the plurals trainees said in testing ("pupils", "pressures").
 */
const ANSWER_TERMS = [
  'pupils', 'pressures', 'Van Herick', 'IOP', 'RAPD', 'angle closure', 'iridotomy', 'iridoplasty', 'pilocarpine',
  'acetazolamide', 'timolol', 'apraclonidine', 'brimonidine', 'mannitol', 'prednisolone',
  'chlorphenamine', 'sulfonamide', 'paracentesis', 'ciliary flush', 'fellow eye',
]

/**
 * Keyterms bias recognition towards specialist vocabulary. Built from the case's finding
 * labels, so editing the case updates them. Deepgram advises 20-50 terms (500-token cap).
 */
export function keyterms(viva: CaseFile): string[] {
  // "Optic disc and fundus" -> "Optic disc", "fundus"; "Axial length (biometry)" -> "Axial length", "biometry".
  // Single words matter: a trainee says "right fundus", not the full label ("Rite Thunder" in testing).
  const fromLabels = viva.findings.flatMap((f) => {
    const inParens = f.label.match(/\(([^)]+)\)/)?.[1]
    const base = f.label.replace(/\s*\([^)]*\)/, '')
    return [...base.split(/\s+and\s+/i), ...(inParens ? [inParens] : [])]
  })
  return [...new Set([...fromLabels, ...ANSWER_TERMS])].slice(0, 50)
}

export interface Recording {
  audio: ArrayBuffer
  contentType: string
}

export async function transcribe(recording: Recording, terms: string[]): Promise<{ transcript: string; ms: number }> {
  const { audio, contentType } = recording
  // punctuate, not smart_format: smart_format formats dates and numbers, so "OCT" said on its own
  // became "October" and "six thirty-six" became "636".
  const params = new URLSearchParams({ model: STT_MODEL, punctuate: 'true', language: 'en' })
  for (const term of terms) params.append('keyterm', term)
  const started = performance.now()
  const response = await fetch(`${API}/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey()}`, 'Content-Type': contentType },
    body: audio,
  })
  if (!response.ok) throw new Error(`Deepgram STT ${response.status}: ${await response.text()}`)
  const json = (await response.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] }
  }
  const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
  return { transcript, ms: performance.now() - started }
}

/**
 * Start text-to-speech and return Deepgram's streaming response as soon as headers arrive,
 * so the browser can start playing before the whole file is generated.
 */
export async function speak(text: string): Promise<{ response: Response; msToHeaders: number }> {
  const params = new URLSearchParams({ model: TTS_MODEL, encoding: 'mp3' })
  const started = performance.now()
  const response = await fetch(`${API}/speak?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) throw new Error(`Deepgram TTS ${response.status}: ${await response.text()}`)
  return { response, msToHeaders: performance.now() - started }
}
