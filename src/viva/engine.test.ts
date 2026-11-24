import { describe, expect, it, vi } from 'vitest'
import { viva } from '../case/case'
import { NOT_IN_CASE } from '../case/format'
import { PROMPTS, runTurn, type ExaminerModel } from './engine'

const fakeModel = (over: Partial<ExaminerModel> = {}): ExaminerModel => ({
  classify: vi.fn(async () => ({ intent: 'finding_request' as const, finding_ids: [] })),
  writeFollowUp: vi.fn(async () => 'Why treat the left eye as well?'),
  ...over,
})

describe('runTurn', () => {
  it('builds the findings reply from the case, not the model', async () => {
    const model = fakeModel({ classify: async () => ({ intent: 'finding_request', finding_ids: ['iop_right'] }) })
    const r = await runTurn(viva, { stage: 'findings', utterance: "what's the right pressure" }, model)
    expect(r.spoken).toBe('Right eye, intraocular pressure: 58 millimetres of mercury.')
    expect(r.revealed.map((f) => f.id)).toEqual(['iop_right'])
    expect(r.nextStage).toBe('findings')
  })

  it('says not available for findings outside the case', async () => {
    const r = await runTurn(viva, { stage: 'findings', utterance: 'visual fields please' }, fakeModel())
    expect(r.spoken).toBe(NOT_IN_CASE)
    expect(r.revealed).toEqual([])
  })

  it('moves to the diagnosis stage when the trainee is ready', async () => {
    const model = fakeModel({ classify: async () => ({ intent: 'ready_to_answer', finding_ids: [] }) })
    const r = await runTurn(viva, { stage: 'findings', utterance: "I'm ready to give my diagnosis" }, model)
    expect(r).toMatchObject({ spoken: PROMPTS.askForAnswer, nextStage: 'diagnosis' })
  })

  it('asks one follow-up after the diagnosis, then closes', async () => {
    const model = fakeModel()
    const r1 = await runTurn(viva, { stage: 'diagnosis', utterance: 'Acute angle closure, give drops' }, model)
    expect(r1).toMatchObject({ nextStage: 'follow_up', followUpQuestion: 'Why treat the left eye as well?' })
    const r2 = await runTurn(viva, { stage: 'follow_up', utterance: 'Because the left angle is narrow' }, model)
    expect(r2).toMatchObject({ spoken: PROMPTS.closing, nextStage: 'complete' })
  })

  it("doesn't count an empty transcript and doesn't call the model", async () => {
    const model = fakeModel()
    const r = await runTurn(viva, { stage: 'findings', utterance: ' . ' }, model)
    expect(r).toMatchObject({ spoken: PROMPTS.didntCatch, counted: false, nextStage: 'findings' })
    expect(model.classify).not.toHaveBeenCalled()
  })
})
