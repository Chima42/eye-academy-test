import { collection, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore'
import { viva } from '../case/case'
import type { Attempt } from '../viva/attempt'
import { db } from './firebase'

/** Attempts live under the owner's uid; firestore.rules allow access only to that uid. */
const attemptsOf = (uid: string) => collection(db, 'users', uid, 'attempts')

export async function createAttempt(uid: string): Promise<string> {
  const ref = doc(attemptsOf(uid))
  const now = Date.now()
  const attempt: Attempt = {
    caseId: viva.case_id,
    createdAt: now,
    updatedAt: now,
    stage: 'findings',
    transcript: [{ role: 'examiner', text: viva.opening_prompt, at: now }],
    revealed: [],
    timings: [],
  }
  await setDoc(ref, attempt)
  return ref.id
}

/** Saved after every turn, so a refresh restores the attempt exactly. */
/** Where one attempt lives: its owner and its id. */
export interface AttemptKey {
  uid: string
  attemptId: string
}

const attemptDoc = (key: AttemptKey) => doc(attemptsOf(key.uid), key.attemptId)

export async function saveAttempt(key: AttemptKey, attempt: Attempt): Promise<void> {
  await setDoc(attemptDoc(key), { ...attempt, updatedAt: Date.now() })
}

export async function getAttempt(key: AttemptKey): Promise<Attempt | null> {
  const snap = await getDoc(attemptDoc(key))
  return snap.exists() ? (snap.data() as Attempt) : null
}

export async function listAttempts(uid: string): Promise<(Attempt & { id: string })[]> {
  const snap = await getDocs(query(attemptsOf(uid), orderBy('createdAt', 'desc')))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Attempt) }))
}
