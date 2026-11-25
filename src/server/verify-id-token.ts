import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FIREBASE_PROJECT_ID } from '../lib/project'

// `firebase emulators:exec` (npm run dev) sets FIREBASE_AUTH_EMULATOR_HOST, so tokens are checked
// against the Auth emulator. Without it, the Admin SDK verifies against Google's real signing keys.
const adminAuth = () => getAuth(getApps()[0] ?? initializeApp({ projectId: FIREBASE_PROJECT_ID }))

export function bearerToken(authorization: string | null | undefined): string | null {
  return authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null
}

/** The signed-in user's uid, or null when the header is missing, malformed, expired or forged. */
export async function verifiedUid(authorization: string | null | undefined): Promise<string | null> {
  const token = bearerToken(authorization)
  if (!token) return null
  try {
    return (await adminAuth().verifyIdToken(token)).uid
  } catch {
    return null
  }
}

/** For the API routes: the verified uid, or null. */
export const signedInUid = (request: Request) => verifiedUid(request.headers.get('authorization'))

export const signInRequired = () => Response.json({ error: 'Sign in required' }, { status: 401 })
