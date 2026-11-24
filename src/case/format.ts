import type { Eye, Finding, FindingsReply, RevealedFinding } from './types'

export const NOT_IN_CASE = "That isn't available for this case."

const EYE_DISPLAY: Record<string, string> = {
  right: 'Right eye',
  left: 'Left eye',
  both: 'Both eyes',
}

function eyeDisplay(eye: Eye): string | null {
  return eye ? EYE_DISPLAY[eye] : null
}

/**
 * A bare measurement is a number or a fraction such as "6/36" or "168/94".
 * Only bare measurements get the unit appended: descriptive values such as
 * "Mid-dilated, 5 mm, unreactive" or "Right +3.50 DS, ..." already carry their units.
 */
function isBareMeasurement(value: string | number): boolean {
  return typeof value === 'number' || /^[\d.+\-/ ]+$/.test(value.trim())
}

/** The value with its unit, exactly as written in the case. Null when the finding has no value. */
export function valueWithUnit(finding: Finding): string | null {
  const { value, unit } = finding
  if (value === null || value === undefined) return null
  if (unit && isBareMeasurement(value)) return `${value} ${unit}`
  return String(value)
}

/** On-screen text. Uses the case JSON verbatim; an unavailable finding never shows its value. */
export function displayText(finding: Finding): string {
  const parts = [eyeDisplay(finding.eye), finding.label].filter(Boolean)
  if (!finding.available) {
    const reason = finding.unavailable_reason ?? 'not recorded'
    return `${parts.join(' · ')} · Not available: ${reason}`
  }
  const value = valueWithUnit(finding) ?? 'No value recorded'
  const method = finding.method ? ` (${finding.method})` : ''
  return `${parts.join(' · ')} · ${value}${method}`
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** 0-99 in words ("36" -> "thirty-six"); larger numbers stay as digits. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n)
  if (n < 20) return ONES[n]
  return n % 10 === 0 ? TENS[n / 10] : `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}`
}

/**
 * Expansions for text-to-speech. Only these patterns change; anything else is
 * spoken exactly as displayed, so voice and screen can't drift apart silently.
 */
function expandForSpeech(text: string, unit: string | null): string {
  let out = text
  if (unit === 'Snellen') {
    // Words, not digits: the voice read "6 36" as "six three six".
    out = out.replace(/(\d+)\/(\d+)\s*Snellen/g, (_m, top: string, bottom: string) =>
      `${numberToWords(Number(top))} ${numberToWords(Number(bottom))} Snellen`,
    )
  }
  out = out
    .replace(/(\d+)\/(\d+)\s*mmHg/g, '$1 over $2 mmHg') // blood pressure
    .replace(/\bmmHg\b/g, 'millimetres of mercury')
    .replace(/\bmm\b/g, 'millimetres')
    .replace(/\bDS\b/g, 'dioptres sphere')
    .replace(/\+(\d)/g, 'plus $1')
    .replace(/\b1\/4\b/g, 'a quarter')
  return out
}

/** Lowercase a label's first letter for mid-sentence use, but keep acronyms like "OCT". */
function midSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label
}

/** Spoken text for one finding: eye first, then label, then value. */
export function spokenText(finding: Finding): string {
  const eye = eyeDisplay(finding.eye)
  const label = eye ? midSentence(finding.label) : finding.label
  const subject = eye ? `${eye}, ${label}` : label
  if (!finding.available) {
    const reason = (finding.unavailable_reason ?? '').replace(/:\s*/g, ', ')
    return `${subject} is not available${reason ? `: ${reason}` : ''}.`
  }
  const value = valueWithUnit(finding)
  return `${subject}: ${value ? expandForSpeech(value, finding.unit) : 'no value recorded'}.`
}

export function revealedFinding(finding: Finding): RevealedFinding {
  return {
    id: finding.id,
    eye: finding.eye,
    label: finding.label,
    available: finding.available,
    display: displayText(finding),
  }
}

/** The model names the missing test, so keep only plain words and cap the length. */
function cleanTestName(name: string): string {
  return name.replace(/[^\p{L}\p{N}\s&/-]/gu, '').trim().slice(0, 60)
}

const notInCaseSentence = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}: not available for this case.`

/**
 * Build the examiner's reply from finding ids chosen by the classifier, plus a sentence for each
 * requested test the case doesn't list. Ids that aren't in the case are ignored, so a made-up id
 * can never reveal anything.
 */
export function replyForFindings(findings: Finding[], ids: string[], notInCase: string[] = []): FindingsReply {
  const byId = new Map(findings.map((f) => [f.id, f]))
  const matched = [...new Set(ids)]
    .map((id) => byId.get(id))
    .filter((f): f is Finding => f !== undefined)
  const missing = notInCase.map(cleanTestName).filter(Boolean).map(notInCaseSentence)
  if (matched.length === 0 && missing.length === 0) return { revealed: [], spoken: NOT_IN_CASE }
  return {
    revealed: matched.map(revealedFinding),
    spoken: [...matched.map(spokenText), ...missing].join(' '),
  }
}
