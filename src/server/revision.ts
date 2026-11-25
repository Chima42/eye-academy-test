import { createServerFn } from '@tanstack/react-start'
import { viva } from '../case/case'
import { RevisionInputSchema } from '../viva/attempt'
import { revisionPoint } from './revision-model'

export const generateRevisionPoint = createServerFn({ method: 'POST' })
  .validator(RevisionInputSchema)
  .handler(async ({ data }) => revisionPoint(viva, data))
