import { getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from 'firebase/firestore'

/**
 * Local demo: Firebase runs entirely in the Emulator Suite. A "demo-" project id
 * tells Firebase there is no real project behind it, so no credentials are needed.
 */
const PROJECT_ID = 'demo-eye-viva'

const firstInit = getApps().length === 0
const app = firstInit
  ? initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key', authDomain: `${PROJECT_ID}.firebaseapp.com` })
  : getApps()[0]

export const auth = getAuth(app)
// Optional attempt fields (e.g. no revision point yet) are simply left out of the document.
export const db = firstInit ? initializeFirestore(app, { ignoreUndefinedProperties: true }) : getFirestore(app)

if (firstInit) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
