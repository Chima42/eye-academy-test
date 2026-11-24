import { describe, expect, it, vi } from 'vitest'
import { viva } from '../case/case'
import { NOT_IN_CASE } from '../case/format'
import { PROMPTS, runTurn, type Classification, type ExaminerModel, type Intent, type Stage } from './engine'

const FOLLOW_UP = 'Why treat the left eye as well?'

function modelThatClassifies(intent: Intent, findingIds: string[] = [], notInCase: string[] = []): ExaminerModel {
  const classification: Classification = { intent, finding_ids: findingIds, not_in_case: notInCase }
  return {
    classify: vi.fn(async () => classification),
    writeFollowUp: vi.fn(async () => FOLLOW_UP),
  }
}

const turn = (stage: Stage, utterance: string, model: ExaminerModel) =>
  runTurn(viva, { stage, utterance, followUpQuestion: FOLLOW_UP }, model)

describe('findings stage', () => {
  it('builds the reply from the case, not the model', async () => {
    const r = await turn('findings', "what's the right pressure", modelThatClassifies('finding_request', ['iop_right']))
    expect(r.spoken).toBe('Right eye, intraocular pressure: 58 millimetres of mercury.')
  })

  it('reveals the findings it read out', async () => {
    const r = await turn('findings', "what's the right pressure", modelThatClassifies('finding_request', ['iop_right']))
    expect(r.revealed.map((f) => f.id)).toEqual(['iop_right'])
  })

  it('says a requested test is not in the case', async () => {
    const r = await turn('findings', 'visual fields please', modelThatClassifies('finding_request'))
    expect(r.spoken).toBe(NOT_IN_CASE)
  })

  it('names the unlisted part of a mixed request', async () => {
    const r = await turn('findings', 'pressure and visual fields', modelThatClassifies('finding_request', ['iop_right'], ['visual fields']))
    expect(r.spoken).toBe('Right eye, intraocular pressure: 58 millimetres of mercury. Visual fields: not available for this case.')
  })

  it('asks which examination for a too-broad request, revealing nothing', async () => {
    const r = await turn('findings', 'Is there anything wrong with the left eye?', modelThatClassifies('too_broad'))
    expect(r).toMatchObject({ spoken: PROMPTS.tooBroad, revealed: [] })
  })

  it('moves to the diagnosis stage when the trainee is ready', async () => {
    const r = await turn('findings', "I'm ready to give my diagnosis", modelThatClassifies('ready_to_answer'))
    expect(r).toMatchObject({ spoken: PROMPTS.askForAnswer, nextStage: 'diagnosis' })
  })

  it('takes a diagnosis given without announcing it as the answer', async () => {
    const r = await turn('findings', "It's acute angle closure, I'd give timolol", modelThatClassifies('gives_answer'))
    expect(r).toMatchObject({ nextStage: 'follow_up', diagnosisAnswer: "It's acute angle closure, I'd give timolol" })
  })
})

describe('diagnosis stage', () => {
  it('asks the one follow-up after the answer', async () => {
    const r = await turn('diagnosis', 'Acute angle closure, give drops', modelThatClassifies('gives_answer'))
    expect(r).toMatchObject({ spoken: FOLLOW_UP, nextStage: 'follow_up', followUpQuestion: FOLLOW_UP })
  })

  it('repeats the question instead of taking "repeat that" as the answer', async () => {
    const r = await turn('diagnosis', 'Sorry, can you repeat the question?', modelThatClassifies('repeat_request'))
    expect(r).toMatchObject({ spoken: PROMPTS.askForAnswer, nextStage: 'diagnosis' })
  })

  it('answers a findings request and keeps waiting for the diagnosis', async () => {
    const r = await turn('diagnosis', "What's the left pressure?", modelThatClassifies('finding_request', ['iop_left']))
    expect(r).toMatchObject({ spoken: 'Left eye, intraocular pressure: 18 millimetres of mercury.', nextStage: 'diagnosis' })
  })
})

describe('follow-up stage', () => {
  it('ends the viva on the answer', async () => {
    const r = await turn('follow_up', 'Because the left angle is narrow', modelThatClassifies('gives_answer'))
    expect(r).toMatchObject({ spoken: PROMPTS.closing, nextStage: 'complete' })
  })

  it('repeats the follow-up question on request', async () => {
    const r = await turn('follow_up', 'Sorry, can you repeat the question?', modelThatClassifies('repeat_request'))
    expect(r).toMatchObject({ spoken: FOLLOW_UP, nextStage: 'follow_up' })
  })
})

describe('empty transcript', () => {
  it("doesn't count", async () => {
    const r = await turn('findings', ' . ', modelThatClassifies('finding_request'))
    expect(r).toMatchObject({ spoken: PROMPTS.didntCatch, counted: false, nextStage: 'findings' })
  })

  it("doesn't call the model", async () => {
    const model = modelThatClassifies('finding_request')
    await turn('findings', ' . ', model)
    expect(model.classify).not.toHaveBeenCalled()
  })
})
