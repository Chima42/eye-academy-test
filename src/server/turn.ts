import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { viva } from '../case/case'
import { runTurn, TurnInputSchema } from '../viva/engine'
import { examinerModel } from './examiner-model'
import { requireSignedIn } from './require-signed-in'

/** One examiner turn. Stateless: the client keeps the attempt and saves it to Firestore. */
export const examinerTurn = createServerFn({ method: 'POST' })
  .middleware([requireSignedIn])
  .validator(TurnInputSchema)
  .handler(async ({ data }) => {
    const started = performance.now()
    const result = await runTurn({ viva, model: examinerModel(viva) }, data)
    setResponseHeader('Server-Timing', `llm;dur=${(performance.now() - started).toFixed(0)}`)
    return result
  })
