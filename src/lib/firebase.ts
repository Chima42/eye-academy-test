import { getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from 'firebase/firestore'
import { FIREBASE_PROJECT_ID } from './project'

const firstInit = getApps().length === 0
const app = firstInit
  ? initializeApp({ projectId: FIREBASE_PROJECT_ID, apiKey: 'demo-key', authDomain: `${FIREBASE_PROJECT_ID}.firebaseapp.com` })
  : getApps()[0]

export const auth = getAuth(app)

/** The Authorization header the server routes and server functions require. */
export async function authHeaders(): Promise<{ Authorization: string }> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Not signed in')
  return { Authorization: `Bearer ${token}` }
}

// Optional attempt fields (e.g. no revision point yet) are simply left out of the document.
export const db = firstInit ? initializeFirestore(app, { ignoreUndefinedProperties: true }) : getFirestore(app)

if (firstInit) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
