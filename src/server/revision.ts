import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { viva } from '../case/case'
import { revisionPoint } from './revision-model'

const RevisionInputSchema = z.object({
  diagnosisAnswer: z.string().max(4000),
  followUpQuestion: z.string().max(1000).optional(),
  followUpAnswer: z.string().max(4000),
})

export const generateRevisionPoint = createServerFn({ method: 'POST' })
  .validator(RevisionInputSchema)
  .handler(async ({ data }) => revisionPoint(viva, data))
