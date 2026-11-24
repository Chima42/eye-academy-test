import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { viva } from '../case/case'
import { runTurn } from '../viva/engine'
import { examinerModel } from './examiner-model'

const TurnInputSchema = z.object({
  stage: z.enum(['findings', 'diagnosis', 'follow_up', 'complete']),
  utterance: z.string().max(4000),
  diagnosisAnswer: z.string().max(4000).optional(),
  previous: z.object({ utterance: z.string().max(4000), findingIds: z.array(z.string()).max(30) }).optional(),
})

/** One examiner turn. Stateless: the client keeps the attempt and saves it to Firestore. */
export const examinerTurn = createServerFn({ method: 'POST' })
  .validator(TurnInputSchema)
  .handler(async ({ data }) => {
    const started = performance.now()
    const result = await runTurn(viva, data, examinerModel(viva))
    setResponseHeader('Server-Timing', `llm;dur=${(performance.now() - started).toFixed(0)}`)
    return result
  })
