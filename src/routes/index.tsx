import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { signOut } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { viva } from '../case/case'
import { SignIn } from '../components/SignIn'
import { RevisionPanel } from '../components/VivaParts'
import { createAttempt, listAttempts } from '../lib/attempts'
import { useAuth } from '../lib/auth'
import { auth } from '../lib/firebase'
import { citedPages, type Attempt } from '../viva/attempt'

export const Route = createFileRoute('/')({
  ssr: false,
  component: Home,
})

/** Where an unfinished viva stopped (the section heading already says "In progress"). */
const STAGE_LABEL: Record<Attempt['stage'], string> = {
  findings: 'Examination stage',
  diagnosis: 'Diagnosis stage',
  follow_up: 'Follow-up stage',
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

  // Newest first within each group (the query already orders by createdAt desc).
  const inProgress = attempts?.filter((attempt) => attempt.stage !== 'complete') ?? []
  const completed = attempts?.filter((attempt) => attempt.stage === 'complete') ?? []

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

      {error && <p role="alert" className="text-red-700">{error}</p>}
      {attempts === null && !error && <p className="text-slate-500">Loading…</p>}
      {attempts?.length === 0 && <p className="text-slate-500">No attempts yet.</p>}

      {inProgress.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">In progress ({inProgress.length})</h2>
          <ul className="space-y-2">
            {inProgress.map((attempt) => (
              <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-4 py-3 shadow-sm">
                <span>
                  {formatDate(attempt.createdAt)}
                  <span className="ml-2 text-sm text-slate-600">{STAGE_LABEL[attempt.stage]} · {revealedCount(attempt)}</span>
                </span>
                <Link to="/viva/$attemptId" params={{ attemptId: attempt.id }} className="rounded bg-indigo-900 px-3 py-1 text-sm text-white">
                  Continue
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Completed ({completed.length})</h2>
          <ul className="space-y-2">
            {completed.map((attempt) => (
              <CompletedAttempt key={attempt.id} attempt={attempt} />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

const revealedCount = (attempt: Attempt) => `${attempt.revealed.length} ${attempt.revealed.length === 1 ? 'finding' : 'findings'} revealed`

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function CompletedAttempt({ attempt }: { attempt: Attempt & { id: string } }) {
  const [open, setOpen] = useState(false)
  const { revision } = attempt
  const pages = revision?.status === 'supported' ? citedPages(revision) : null
  return (
    <li className="rounded-lg bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p>
            {formatDate(attempt.createdAt)}
            <span className="ml-2 text-sm text-slate-600">{revealedCount(attempt)}</span>
          </p>
          <p className="text-sm text-slate-600">
            {revision ? <>Revise: {revision.gap}{pages && <> · {pages}</>}</> : 'No revision point yet'}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {revision && (
            <button onClick={() => setOpen(!open)} aria-expanded={open} className="rounded border border-indigo-900 px-3 py-1 text-indigo-900">
              {open ? 'Hide revision point' : 'Show revision point'}
            </button>
          )}
          <Link to="/viva/$attemptId" params={{ attemptId: attempt.id }} className="rounded border px-3 py-1">
            {revision ? 'Open transcript' : 'Open'}
          </Link>
        </div>
      </div>
      {open && revision && (
        <div className="mt-3">
          <RevisionPanel revision={revision} />
        </div>
      )}
    </li>
  )
}
