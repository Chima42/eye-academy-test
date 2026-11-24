import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { signOut } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { viva } from '../case/case'
import { SignIn } from '../components/SignIn'
import { createAttempt, listAttempts } from '../lib/attempts'
import { useAuth } from '../lib/auth'
import { auth } from '../lib/firebase'
import type { Attempt } from '../viva/attempt'

export const Route = createFileRoute('/')({
  ssr: false,
  component: Home,
})

const STAGE_LABEL: Record<Attempt['stage'], string> = {
  findings: 'In progress · findings',
  diagnosis: 'In progress · diagnosis',
  follow_up: 'In progress · follow-up',
  complete: 'Complete',
}

function Home() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [attempts, setAttempts] = useState<(Attempt & { id: string })[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    listAttempts(user.uid)
      .then(setAttempts)
      .catch(() => setError('Could not load your attempts. Is the Firebase emulator running?'))
  }, [user])

  if (loading) return <p className="p-8">Loading…</p>
  if (!user) return <SignIn />

  async function start() {
    const id = await createAttempt(user!.uid)
    await navigate({ to: '/viva/$attemptId', params: { attemptId: id } })
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">Eye Academy · Voice viva</p>
          <h1 className="text-2xl font-semibold">{viva.title}</h1>
        </div>
        <div className="text-right text-sm">
          <p>{user.email}</p>
          <button onClick={() => signOut(auth)} className="text-indigo-900 underline">Sign out</button>
        </div>
      </header>

      <button onClick={start} className="w-full rounded-xl bg-indigo-900 py-4 text-lg font-semibold text-white">
        Start a new viva
      </button>

      <section>
        <h2 className="mb-2 font-semibold">Your attempts</h2>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {attempts === null && !error && <p className="text-slate-500">Loading…</p>}
        {attempts?.length === 0 && <p className="text-slate-500">No attempts yet.</p>}
        <ul className="space-y-2">
          {attempts?.map((a) => (
            <li key={a.id}>
              <Link
                to="/viva/$attemptId"
                params={{ attemptId: a.id }}
                className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm hover:bg-indigo-50"
              >
                <span>{new Date(a.createdAt).toLocaleString('en-GB')}</span>
                <span className="text-sm text-slate-600">
                  {STAGE_LABEL[a.stage]} · {a.revealed.length} findings
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
