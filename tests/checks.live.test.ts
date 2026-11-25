/**
 * The three repeatable checks from the brief, run against the real model.
 * Text goes through the same engine as speech; only speech-to-text is skipped, except in the
 * one speech round-trip check.
 * Run with: npm run test:checks   (results are written up in CHECKS.md)
 */
import { describe, expect, it } from 'vitest'
import { viva } from '../src/case/case'
import note from '../data/note-chunks.json'
import { locateExcerpt } from '../src/note/chunk'
import { keyterms, speak, transcribe } from '../src/server/deepgram'
import { examinerModel } from '../src/server/examiner-model'
import { pointFromNote, revisionPoint } from '../src/server/revision-model'
import { runTurn } from '../src/viva/engine'

const model = examinerModel(viva)
const ask = (utterance: string) => runTurn(viva, { stage: 'findings', utterance }, model)
const NOT_AVAILABLE = /not available for this case|isn't available for this case/

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
    expect(r.spoken).toMatch(NOT_AVAILABLE)
  })
})

describe('Too-broad requests', () => {
  it('"Is there anything wrong with the left eye?" -> asks which examination, reveals nothing', async () => {
    const r = await ask('Is there anything wrong with the left eye?')
    console.log('[too broad]', r.spoken)
    expect(r.revealed).toEqual([])
  })

  it.each([
    ['Talk to me about the acuity of the eye.', ['va_left', 'va_right']],
    ['Tell me about the pressure of the eye', ['iop_left', 'iop_right']],
  ])('"%s" names an examination, so it is answered', async (utterance, ids) => {
    const r = await ask(utterance)
    expect(r.revealed.map((f) => f.id).sort()).toEqual(ids)
  })

  it('"Pressures, pupils and gonioscopy in both eyes" is still specific', async () => {
    const r = await ask('Pressures, pupils and gonioscopy in both eyes')
    expect(r.revealed.map((f) => f.id).sort()).toEqual(['gonio_left', 'gonio_right', 'iop_left', 'iop_right', 'pupil_left', 'pupil_right'])
  })
})

describe('Never guess (from manual testing)', () => {
  // Phrasings that broke in the app: a mishearing mapped to the wrong finding, a missing test
  // routed to the history prompt, and a different measurement matched to the cornea finding.
  it.each([
    ['Rite Thunder', 'other'],
    ['What are her visual fields?', 'finding_request'],
    ['Corneal thickness', 'finding_request'],
    ['HbA1c', 'finding_request'],
  ])('"%s" reveals nothing (intent %s)', async (utterance) => {
    const r = await ask(utterance)
    console.log(`[never guess] ${utterance} ->`, r.spoken)
    expect(r.revealed).toEqual([])
  })

  it('"What are her visual fields?" says not available, not the history prompt', async () => {
    const r = await ask('What are her visual fields?')
    expect(r.spoken).toMatch(NOT_AVAILABLE)
  })
})

describe('Follow-on requests use the previous request', () => {
  it('"And what about the left eye?" after right gonioscopy -> left gonioscopy', async () => {
    const r = await runTurn(
      viva,
      { stage: 'findings', utterance: 'And what about the left eye?', previous: { utterance: 'Can I see the gonioscopy on the right?', findingIds: ['gonio_right'] } },
      model,
    )
    console.log('[follow-on]', r.revealed.map((f) => f.display))
    expect(r.revealed.map((f) => f.id)).toEqual(['gonio_left'])
  })
})

describe('A diagnosis given during the findings stage', () => {
  it('is taken as the answer and gets the follow-up, not "what is your diagnosis?"', async () => {
    const r = await ask("I think this is acute angle closure. I'd lie her flat and give timolol and apraclonidine.")
    console.log('[early diagnosis]', r.spoken)
    expect(r.nextStage).toBe('follow_up')
    expect(r.diagnosisAnswer).toContain('angle closure')
  })

  it('a question that mentions a condition is still a findings request', async () => {
    const r = await ask("Could this be glaucoma? What's the pressure in the right eye?")
    expect(r.nextStage).toBe('findings')
    expect(r.revealed.map((f) => f.id)).toEqual(['iop_right'])
  })
})

describe('Mixed request: a finding plus a test the case does not list', () => {
  it('"Pressure and visual fields" reads the pressures and says visual fields is not available', async () => {
    const r = await ask("What's the pressure and the visual fields?")
    console.log('[mixed]', r.spoken)
    expect(r.revealed.map((f) => f.id).sort()).toEqual(['iop_left', 'iop_right'])
    expect(r.spoken).toMatch(/visual fields: not available for this case/i)
  })
})

describe('Answer stages', () => {
  const FOLLOW_UP = 'Why might you treat the left eye as well?'
  const answerTurn = (stage: 'diagnosis' | 'follow_up', utterance: string) =>
    runTurn(viva, { stage, utterance, followUpQuestion: FOLLOW_UP }, model)

  it('"Sorry, can you repeat the question?" repeats the follow-up and does not end the viva', async () => {
    const r = await answerTurn('follow_up', 'Sorry, can you repeat the question?')
    expect(r).toMatchObject({ spoken: FOLLOW_UP, nextStage: 'follow_up' })
  })

  it('a findings request during the diagnosis stage is answered, not taken as the diagnosis', async () => {
    const r = await answerTurn('diagnosis', "Before I answer, what's the pressure in the left eye?")
    expect(r).toMatchObject({ nextStage: 'diagnosis' })
    expect(r.revealed.map((f) => f.id)).toEqual(['iop_left'])
  })

  it('an answer that mentions a finding is still the answer', async () => {
    const r = await answerTurn('diagnosis', "Acute angle closure. I'd lower the pressure with timolol and apraclonidine.")
    expect(r.nextStage).toBe('follow_up')
  })

  it('"I don\'t know" is an answer', async () => {
    const r = await answerTurn('follow_up', "I don't know")
    expect(r.nextStage).toBe('complete')
  })
})

describe('Speech-to-text', () => {
  it('"OCT" said on its own is transcribed as OCT, not "October", and reveals the OCT finding', async () => {
    const { response } = await speak('O. C. T.')
    const { transcript } = await transcribe(await response.arrayBuffer(), 'audio/mpeg', keyterms(viva))
    console.log('[stt oct] transcript:', transcript)
    expect(transcript).toMatch(/\bOCT\b/i)
    expect(transcript).not.toMatch(/october/i)
    const r = await ask(transcript)
    expect(r.revealed.map((f) => f.id)).toEqual(['oct'])
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
    // The cited passage supports treating the fellow eye: prophylactic LPI in the fellow eye (p6),
    // pilocarpine and prompt iridotomy for the other eye (p5), LPI after APAC "in both eyes" (p7).
    expect(['p6-8', 'p5-13', 'p7-2']).toContain(r.chunkId)
    // Verbatim: the excerpt shown is the note's own text, and the cited page is where it's printed.
    const cited = note.chunks.find((c) => c.id === r.chunkId)!
    expect(cited.text).toContain(r.excerpt)
    expect(locateExcerpt(cited, r.excerpt)?.pages).toEqual(r.pages)
    expect(r.page).toBe(r.pages?.[0])
  })

  it('says so when the note has no support (a gap the note does not cover)', async () => {
    const r = await pointFromNote(
      viva,
      input,
      'Long-term control of her systemic hypertension',
      'Choosing an antihypertensive drug and blood pressure target for a patient on amlodipine',
    )
    console.log('[check 3b]', JSON.stringify({ status: r.status, reason: 'reason' in r ? r.reason : undefined, retrieved: r.retrieved.map((p) => p.chunkId) }))
    expect(r.status).toBe('unsupported')
  })
})
