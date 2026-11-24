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
export async function saveAttempt(uid: string, id: string, attempt: Attempt): Promise<void> {
  await setDoc(doc(attemptsOf(uid), id), { ...attempt, updatedAt: Date.now() })
}

export async function getAttempt(uid: string, id: string): Promise<Attempt | null> {
  const snap = await getDoc(doc(attemptsOf(uid), id))
  return snap.exists() ? (snap.data() as Attempt) : null
}

export async function listAttempts(uid: string): Promise<(Attempt & { id: string })[]> {
  const snap = await getDocs(query(attemptsOf(uid), orderBy('createdAt', 'desc')))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Attempt) }))
}
