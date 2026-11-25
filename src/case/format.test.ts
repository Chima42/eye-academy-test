import { describe, expect, it } from 'vitest'
import { viva } from './case'
import { NOT_IN_CASE, displayText, numberToWords, replyForFindings, spokenText } from './format'
import type { Finding } from './types'

const finding = (id: string): Finding => {
  const f = viva.findings.find((x) => x.id === id)
  if (!f) throw new Error(`No finding ${id} in case`)
  return f
}

describe('available findings keep eye, value and units', () => {
  it('right IOP', () => {
    const f = finding('iop_right')
    expect(displayText(f)).toBe('Right eye · Intraocular pressure · 58 mmHg (Goldmann applanation, 23:55)')
    expect(spokenText(f)).toBe('Right eye, intraocular pressure: 58 millimetres of mercury.')
  })

  it('left IOP is not confused with right', () => {
    expect(spokenText(finding('iop_left'))).toBe('Left eye, intraocular pressure: 18 millimetres of mercury.')
  })

  it('Snellen acuity is spoken as "six thirty-six" with its unit', () => {
    const f = finding('va_right')
    expect(displayText(f)).toContain('6/36 Snellen')
    expect(spokenText(f)).toBe('Right eye, visual acuity: six thirty-six Snellen.')
  })

  it('blood pressure has no eye and is spoken as "over"', () => {
    const f = finding('bp')
    expect(displayText(f)).toBe('Blood pressure · 168/94 mmHg (Automated cuff)')
    expect(spokenText(f)).toBe('Blood pressure: 168 over 94 millimetres of mercury.')
  })

  it('does not double a unit already in the value (pupil "5 mm")', () => {
    const f = finding('pupil_right')
    expect(displayText(f)).toContain('Mid-dilated, 5 mm, unreactive to light (Pen torch)')
    expect(displayText(f)).not.toMatch(/mm\s+mm/)
    expect(spokenText(f)).toBe('Right eye, pupil: Mid-dilated, 5 millimetres, unreactive to light.')
  })

  it('does not append a unit to a descriptive value (refraction)', () => {
    const f = finding('refraction')
    expect(displayText(f)).not.toContain('dioptres')
    expect(spokenText(f)).toContain('plus 3.50 dioptres sphere')
  })

  it('expands "1/4" in prose', () => {
    expect(spokenText(finding('ac_right'))).toContain('under a quarter of corneal thickness')
  })
})

describe('unavailable findings', () => {
  it('give the reason and never a value', () => {
    const f = finding('gonio_right')
    expect(displayText(f)).toBe('Right eye · Gonioscopy · Not available: No view: corneal oedema')
    expect(spokenText(f)).toBe('Right eye, gonioscopy is not available: No view, corneal oedema.')
  })

  it('ignore a value field even when one is present (RAPD)', () => {
    const f = finding('rapd')
    expect(f.value).not.toBeNull() // the trap: the JSON has a value on an unavailable finding
    expect(displayText(f)).not.toContain(String(f.value))
    expect(spokenText(f)).not.toContain(String(f.value))
  })

  it('never say "null" for a unit with no value (axial length)', () => {
    const f = finding('axial_length')
    expect(displayText(f)).toBe('Both eyes · Axial length (biometry) · Not available: Not performed in casualty')
    expect(spokenText(f)).not.toMatch(/null|undefined|millimetres/)
  })
})

describe('every finding in the case', () => {
  it.each(viva.findings.map((f) => [f.id, f] as const))('%s is well formed', (_id, f) => {
    const display = displayText(f)
    const spoken = spokenText(f)
    for (const text of [display, spoken]) {
      expect(text).not.toMatch(/\bnull\b|\bundefined\b/)
      expect(text).not.toMatch(/\b(mm|mmHg)\s+\1\b/)
    }
    if (f.eye && f.eye !== 'both') {
      const eye = f.eye === 'right' ? 'Right eye' : 'Left eye'
      expect(display.startsWith(eye)).toBe(true)
      expect(spoken.startsWith(eye)).toBe(true)
    }
    if (f.available && f.value !== null) {
      expect(display).toContain(String(f.value))
      // Every number in the value is also spoken, except where an allowlisted
      // expansion turns it into words ("1/4" -> "a quarter").
      const numbers = String(f.value).replace(/\b1\/4\b/g, '').match(/\d+(\.\d+)?/g) ?? []
      for (const n of numbers) expect([n, numberToWords(Number(n))].some((form) => spoken.includes(form))).toBe(true)
    } else {
      expect(spoken).toContain('not available')
    }
  })
})

describe('numberToWords', () => {
  it.each([
    [6, 'six'],
    [9, 'nine'],
    [18, 'eighteen'],
    [36, 'thirty-six'],
    [60, 'sixty'],
  ])('%i -> %s', (n, words) => {
    expect(numberToWords(n)).toBe(words)
  })

  it('leaves numbers above 99 as digits', () => {
    expect(numberToWords(168)).toBe('168')
  })
})

describe('every bare measurement speaks its unit', () => {
  const SPOKEN_UNIT: Record<string, string> = { mmHg: 'millimetres of mercury', Snellen: 'Snellen' }
  const bareMeasurements = viva.findings.filter(
    (f) => f.available && f.unit && f.value !== null && /^[\d.+\-/ ]+$/.test(String(f.value)),
  )

  it.each(bareMeasurements.map((f) => [f.id, f] as const))('%s', (_id, f) => {
    expect(spokenText(f)).toContain(SPOKEN_UNIT[f.unit!] ?? f.unit)
  })
})

describe('replyForFindings', () => {
  it('returns both eyes when asked for both', () => {
    const reply = replyForFindings(viva.findings, ['iop_right', 'iop_left'])
    expect(reply.revealed.map((r) => r.id)).toEqual(['iop_right', 'iop_left'])
    expect(reply.spoken).toBe(
      'Right eye, intraocular pressure: 58 millimetres of mercury. Left eye, intraocular pressure: 18 millimetres of mercury.',
    )
  })

  it('says "not available for this case" when nothing matched', () => {
    expect(replyForFindings(viva.findings, [])).toEqual({ revealed: [], spoken: NOT_IN_CASE })
  })

  it('names a requested test the case does not list, alongside the findings', () => {
    const reply = replyForFindings(viva.findings, ['iop_right'], ['visual fields'])
    expect(reply.spoken).toBe('Right eye, intraocular pressure: 58 millimetres of mercury. Visual fields: not available for this case.')
  })

  it('strips anything but plain words from a test name before speaking it', () => {
    expect(replyForFindings(viva.findings, [], ['<visual fields>!']).spoken).toBe('Visual fields: not available for this case.')
  })

  it('ignores ids that are not in the case', () => {
    const reply = replyForFindings(viva.findings, ['visual_fields', 'iop_right'])
    expect(reply.revealed.map((r) => r.id)).toEqual(['iop_right'])
  })

  it('snapshots what was shown', () => {
    const [r] = replyForFindings(viva.findings, ['gonio_right']).revealed
    expect(r).toEqual({
      id: 'gonio_right',
      eye: 'right',
      label: 'Gonioscopy',
      available: false,
      display: 'Right eye · Gonioscopy · Not available: No view: corneal oedema',
    })
  })
})
