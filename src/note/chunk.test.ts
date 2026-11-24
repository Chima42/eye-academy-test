import { describe, expect, it } from 'vitest'
import note from '../../data/note-chunks.json'
import { locateExcerpt } from './chunk'

const chunk = (id: string) => {
  const c = note.chunks.find((x) => x.id === id)
  if (!c) throw new Error(`No chunk ${id}`)
  return c
}

describe('prepared note (data/note-chunks.json)', () => {
  it('covers every page', () => {
    const pages = new Set(note.chunks.flatMap((c) => c.pages))
    expect([...pages].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('strips the running header and footer', () => {
    for (const c of note.chunks) {
      expect(c.text).not.toContain('Take-home reference note')
      expect(c.text).not.toContain('Eye Academy reference note')
    }
  })

  it('keeps the acetazolamide paragraph whole across the page 5-6 break', () => {
    const c = chunk('p5-14')
    expect(c.pages).toEqual([5, 6])
    expect(c.text).toContain('then 250 mg four times a day')
  })

  it('does not merge separate bullets across a page break (p3 haloes / p4 nausea)', () => {
    expect(chunk('p3-13').text).toBe('Blurred vision and coloured haloes around lights, caused by corneal oedema')
    expect(chunk('p4-1').text.startsWith('Nausea')).toBe(true)
  })

  it('reads table rows with their column names', () => {
    expect(chunk('p9-8').text).toContain('Class: Systemic carbonic anhydrase inhibitors. Examples: Acetazolamide.')
  })
})

describe('locateExcerpt: citation check and exact page', () => {
  const acetazolamide = chunk('p5-14')

  it('cites page 5 for the part of a cross-page paragraph printed on page 5', () => {
    expect(locateExcerpt(acetazolamide, 'Acetazolamide 500 mg, given intravenously if the IOP is above about 50 mmHg')).toBe(5)
  })

  it('cites page 6 for the part printed on page 6', () => {
    expect(locateExcerpt(acetazolamide, 'Check for sulfonamide allergy, kidney disease, low potassium and sickle cell disease')).toBe(6)
  })

  it('accepts quotes, curly apostrophes and a trailing ellipsis', () => {
    expect(locateExcerpt(chunk('p6-8'), '“Prophylactic LPI in the fellow eye, because without treatment around 40 to 50% of fellow eyes…”')).toBe(6)
  })

  it('rejects an excerpt that is not verbatim in the chunk', () => {
    expect(locateExcerpt(chunk('p6-8'), 'Prophylactic LPI in the fellow eye prevents all future attacks')).toBeNull()
  })

  it('rejects an excerpt from a different chunk', () => {
    expect(locateExcerpt(chunk('p6-8'), 'Check for sulfonamide allergy, kidney disease')).toBeNull()
  })

  it('rejects excerpts too short to be meaningful', () => {
    expect(locateExcerpt(chunk('p6-8'), 'fellow eye')).toBeNull()
  })
})
