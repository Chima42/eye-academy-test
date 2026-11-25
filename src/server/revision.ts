import { createServerFn } from '@tanstack/react-start'
import { viva } from '../case/case'
import { RevisionInputSchema } from '../viva/attempt'
import { requireSignedIn } from './require-signed-in'
import { revisionPoint } from './revision-model'

export const generateRevisionPoint = createServerFn({ method: 'POST' })
  .middleware([requireSignedIn])
  .validator(RevisionInputSchema)
  .handler(async ({ data }) => revisionPoint(viva, data))
