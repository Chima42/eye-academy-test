import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeader, setResponseStatus } from '@tanstack/react-start/server'
import { authHeaders } from '../lib/firebase'

/** Server-function middleware: the browser sends the user's ID token, the server verifies it. */
export const requireSignedIn = createMiddleware({ type: 'function' })
  .client(async ({ next }) => next({ headers: await authHeaders() }))
  .server(async ({ next }) => {
    // Imported here so the Admin SDK never reaches the browser bundle.
    const { verifiedUid } = await import('./verify-id-token')
    const uid = await verifiedUid(getRequestHeader('authorization'))
    if (!uid) {
      setResponseStatus(401)
      throw new Error('Sign in required')
    }
    return next({ context: { uid } })
  })
