import { describe, expect, it } from 'vitest'
import { citedPages, needsRevisionPoint, previousRequest, revisionInputOf, withTurn, type Attempt, type RevisionPoint } from './attempt'
import type { TurnResult } from './engine'

const AT = 1_700_000_000_000
const rightIop = { id: 'iop_right', eye: 'right' as const, label: 'Intraocular pressure', available: true, display: 'Right eye · Intraocular pressure · 58 mmHg' }

const fresh = (overrides: Partial<Attempt> = {}): Attempt => ({
  caseId: 'EA-VIVA-001',
  createdAt: AT,
  updatedAt: AT,
  stage: 'findings',
  transcript: [{ role: 'examiner', text: 'Opening prompt', at: AT }],
  revealed: [],
  timings: [],
  ...overrides,
})

const result = (overrides: Partial<TurnResult> = {}): TurnResult => ({ spoken: 'Reply', revealed: [], nextStage: 'findings', counted: true, ...overrides })

describe('withTurn', () => {
  it('adds the trainee line and the examiner reply to the transcript', () => {
    const next = withTurn(fresh(), { utterance: { text: 'right pressure', source: 'voice' }, result: result(), at: AT })
    expect(next.transcript.slice(1).map((entry) => [entry.role, entry.text])).toEqual([['trainee', 'right pressure'], ['examiner', 'Reply']])
  })

  it('leaves out a trainee line that did not count', () => {
    const next = withTurn(fresh(), { utterance: { text: '.', source: 'voice' }, result: result({ counted: false }), at: AT })
    expect(next.transcript.slice(1).map((entry) => entry.role)).toEqual(['examiner'])
  })

  it('adds revealed findings once, keeping the first snapshot', () => {
    const later = { ...rightIop, display: 'changed' }
    const next = withTurn(fresh({ revealed: [rightIop] }), { utterance: { text: 'again', source: 'text' }, result: result({ revealed: [later] }), at: AT })
    expect(next.revealed).toEqual([rightIop])
  })

  it('records the follow-up answer when answering in the follow-up stage', () => {
    const next = withTurn(fresh({ stage: 'follow_up' }), { utterance: { text: 'treat the left eye', source: 'voice' }, result: result({ nextStage: 'complete' }), at: AT })
    expect(next).toMatchObject({ stage: 'complete', followUpAnswer: 'treat the left eye' })
  })
})

describe('previousRequest', () => {
  it('is the last trainee request and what it revealed', () => {
    const attempt = withTurn(fresh(), { utterance: { text: 'right pressure', source: 'voice' }, result: result({ revealed: [rightIop] }), at: AT })
    expect(previousRequest(attempt)).toEqual({ utterance: 'right pressure', findingIds: ['iop_right'] })
  })

  it('is undefined outside the findings stage', () => {
    expect(previousRequest(fresh({ stage: 'diagnosis' }))).toBeUndefined()
  })
})

describe('revision point inputs', () => {
  it('is due once the viva is complete and has none yet', () => {
    expect(needsRevisionPoint(fresh({ stage: 'complete' }))).toBe(true)
  })

  it('fills missing answers with empty strings', () => {
    expect(revisionInputOf(fresh({ followUpQuestion: 'Why?' }))).toEqual({ diagnosisAnswer: '', followUpQuestion: 'Why?', followUpAnswer: '' })
  })
})

describe('citedPages', () => {
  const supported = (pages: number[]): Extract<RevisionPoint, { status: 'supported' }> => ({
    status: 'supported', gap: '', point: '', excerpt: '', page: pages[0], pages, chunkId: 'p6-8', retrieved: [],
  })

  it('names one page', () => {
    expect(citedPages(supported([6]))).toBe('page 6')
  })

  it('names both pages when the quote runs over a page break', () => {
    expect(citedPages(supported([5, 6]))).toBe('pages 5–6')
  })
})
