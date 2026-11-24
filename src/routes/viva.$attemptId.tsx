import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { viva } from '../case/case'
import { SignIn } from '../components/SignIn'
import { FindingsPanel, HistoryCard, RevisionPanel, StatusIndicator, Transcript } from '../components/VivaParts'
import { useAuth } from '../lib/auth'
import { useViva } from '../viva/useViva'

export const Route = createFileRoute('/viva/$attemptId')({
  ssr: false, // auth state, mic and audio are browser-only
  component: VivaPage,
})

function VivaPage() {
  const { user, loading } = useAuth()
  const { attemptId } = Route.useParams()
  if (loading) return <p className="p-8">Loading…</p>
  if (!user) return <SignIn />
  return <Viva uid={user.uid} attemptId={attemptId} />
}

function Viva({ uid, attemptId }: { uid: string; attemptId: string }) {
  const v = useViva(uid, attemptId)
  const [text, setText] = useState('')
  const { attempt, status } = v

  // Spacebar push-to-talk (ignored while typing in the text box).
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName === 'INPUT'
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing(e)) {
        e.preventDefault()
        v.startTalking()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) {
        e.preventDefault()
        void v.stopTalking()
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [v])

  if (!attempt) return <p className="p-8">Loading attempt…</p>

  const complete = attempt.stage === 'complete'
  const canTalk = status === 'idle' && v.micReady && !complete
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    v.submitText(text.trim())
    setText('')
  }
  const stageHint = {
    findings: 'Ask for examination findings. When you are ready, give your diagnosis.',
    diagnosis: 'Give your diagnosis and immediate management.',
    follow_up: 'Answer the examiner’s follow-up question.',
    complete: 'Viva complete.',
  }[attempt.stage]

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/" className="text-sm text-indigo-900 underline">← Your attempts</Link>
          <h1 className="text-2xl font-semibold">{viva.title}</h1>
          <p className="text-sm text-slate-600">{stageHint}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-4">
          <HistoryCard viva={viva} />
          <FindingsPanel findings={attempt.revealed} />
        </div>

        <div className="space-y-4">
          {!complete && (
            <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
              <StatusIndicator status={status} />
              {status === 'not_started' ? (
                <button onClick={() => void v.begin()} className="w-full rounded-xl bg-indigo-900 py-4 text-lg font-semibold text-white">
                  {attempt.transcript.length > 1 ? 'Resume viva' : 'Start viva'}
                </button>
              ) : (
                <>
                  <button
                    disabled={!canTalk && status !== 'listening'}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      v.startTalking()
                    }}
                    onPointerUp={() => void v.stopTalking()}
                    onPointerCancel={() => void v.stopTalking()}
                    className={`w-full select-none touch-none rounded-xl py-6 text-lg font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300 ${status === 'listening' ? 'bg-red-600' : 'bg-emerald-700'}`}
                  >
                    {status === 'listening' ? 'Release to send' : 'Hold to speak'}
                  </button>
                  <form onSubmit={submit} className="flex gap-2">
                    <input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      disabled={status !== 'idle'}
                      placeholder="Or type here (noisy room, no mic)…"
                      aria-label="Type your question or answer"
                      className="flex-1 rounded border px-3 py-2 disabled:bg-slate-100"
                    />
                    <button disabled={status !== 'idle'} className="rounded bg-slate-800 px-4 text-white disabled:opacity-40">Send</button>
                  </form>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {attempt.stage === 'findings' && (
                      <button onClick={() => void v.moveToDiagnosis()} disabled={status !== 'idle'} className="rounded border border-indigo-900 px-3 py-1 text-indigo-900 disabled:opacity-40">
                        Give my diagnosis
                      </button>
                    )}
                    <button onClick={() => void v.repeatLast()} disabled={status !== 'idle'} className="rounded border px-3 py-1 disabled:opacity-40">
                      Repeat last
                    </button>
                  </div>
                </>
              )}
              {v.error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{v.error}</p>}
            </section>
          )}

          {complete && status === 'reviewing' && <StatusIndicator status={status} />}
          {attempt.revision && <RevisionPanel revision={attempt.revision} />}
          {complete && !attempt.revision && status !== 'reviewing' && (
            <button onClick={() => void v.begin()} className="rounded bg-indigo-900 px-4 py-2 text-white">Generate revision point</button>
          )}

          <Transcript entries={attempt.transcript} />

          {attempt.timings.length > 0 && (
            <p className="text-xs text-slate-500">
              Last voice turn: {Math.round(attempt.timings.at(-1)!.totalMs)} ms (release → examiner audio). Turns timed: {attempt.timings.length}.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
