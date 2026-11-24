import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { viva } from '../case/case'
import { revisionPoint } from './revision-model'

const RevisionInputSchema = z.object({
  diagnosisAnswer: z.string().max(4000),
  followUpQuestion: z.string().max(1000).optional(),
  followUpAnswer: z.string().max(4000),
})

/** After the viva: one revision point from the reference note, with page and excerpt. */
export const generateRevisionPoint = createServerFn({ method: 'POST' })
  .validator(RevisionInputSchema)
  .handler(async ({ data }) => revisionPoint(viva, data))
