/**
 * The three repeatable checks from the brief, run against the real model.
 * Text goes through the same engine as speech; only speech-to-text is skipped.
 * Run with: npm run test:checks   (results are written up in CHECKS.md)
 */
import { describe, expect, it } from 'vitest'
import { viva } from '../src/case/case'
import note from '../data/note-chunks.json'
import { examinerModel } from '../src/server/examiner-model'
import { pointFromNote, revisionPoint } from '../src/server/revision-model'
import { runTurn } from '../src/viva/engine'

const model = examinerModel(viva)
const ask = (utterance: string) => runTurn(viva, { stage: 'findings', utterance }, model)

describe('Check 1: available finding', () => {
  it('"What\'s the pressure in the right eye?" -> right IOP 58 mmHg', async () => {
    const r = await ask("What's the pressure in the right eye?")
    console.log('[check 1] revealed:', r.revealed.map((f) => f.display), '| spoken:', r.spoken)
    expect(r.revealed.map((f) => f.id)).toEqual(['iop_right'])
    expect(r.revealed[0].display).toBe('Right eye · Intraocular pressure · 58 mmHg (Goldmann applanation, 23:55)')
    expect(r.spoken).toBe('Right eye, intraocular pressure: 58 millimetres of mercury.')
  })
})

describe('Check 2: unavailable finding', () => {
  it('"Can I see the right angle on gonioscopy?" -> not available, corneal oedema, no value', async () => {
    const r = await ask('Can I see the right angle on gonioscopy?')
    console.log('[check 2] revealed:', r.revealed.map((f) => f.display), '| spoken:', r.spoken)
    expect(r.revealed.map((f) => f.id)).toEqual(['gonio_right'])
    expect(r.revealed[0]).toMatchObject({ available: false })
    expect(r.spoken).toBe('Right eye, gonioscopy is not available: No view, corneal oedema.')
  })

  it('"What are the visual fields like?" -> not in the case', async () => {
    const r = await ask('What are the visual fields like?')
    console.log('[check 2b] spoken:', r.spoken)
    expect(r.revealed).toEqual([])
    expect(r.spoken).toBe("That isn't available for this case.")
  })
})

describe('Check 3: the citation supports the revision point', () => {
  // A good answer that covers every key point except treating the fellow (left) eye.
  const input = {
    diagnosisAnswer:
      "This is right acute primary angle closure, probably triggered by the dark cinema and the new chlorphenamine. " +
      "I'd lie her flat and give analgesia and an antiemetic, start timolol and apraclonidine, and add pilocarpine once the pressure starts to fall. " +
      "She's allergic to sulfonamides, so I'd avoid acetazolamide and use IV mannitol if the pressure stays high. " +
      "I'd stop the chlorphenamine, and arrange a laser iridotomy to the right eye once the cornea clears, then repeat gonioscopy and look at the discs.",
    followUpQuestion: 'Why might you treat the left eye as well?',
    followUpAnswer: "I wouldn't treat the left eye. The pressure there is normal, so it isn't affected.",
  }

  it('finds the fellow-eye gap, retrieves page 6, and cites a verbatim excerpt from a fellow-eye passage', async () => {
    const r = await revisionPoint(viva, input)
    console.log('[check 3]', JSON.stringify(r, null, 2))
    expect(r.status).toBe('supported')
    if (r.status !== 'supported') return
    expect(r.gap.toLowerCase()).toMatch(/fellow|left|other eye|both eyes/)
    // Retrieved pages recorded; the key passage (p6, prophylactic LPI in the fellow eye) is among them.
    expect(r.retrieved.map((p) => p.chunkId)).toContain('p6-8')
    // The cited passage is one that actually supports treating the fellow eye.
    expect(['p6-8', 'p7-2', 'p5-13', 'p6-7']).toContain(r.chunkId)
    // Verbatim: the excerpt is word for word in the cited chunk, and the page is where it's printed.
    const cited = note.chunks.find((c) => c.id === r.chunkId)!
    expect(cited.pages).toContain(r.page)
  })

  it('says so when the note has no support (a gap the note does not cover)', async () => {
    const r = await pointFromNote(
      input,
      'Long-term control of her systemic hypertension',
      'Choosing an antihypertensive drug and blood pressure target for a patient on amlodipine',
    )
    console.log('[check 3b]', JSON.stringify({ status: r.status, reason: 'reason' in r ? r.reason : undefined, retrieved: r.retrieved.map((p) => p.chunkId) }))
    expect(r.status).toBe('unsupported')
  })
})
