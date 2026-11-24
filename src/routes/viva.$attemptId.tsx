import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
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

const FINDINGS_OPEN_KEY = 'viva.findingsOpen'

/** Per-browser preference for the findings panel; storage can be unavailable (private mode). */
function useFindingsOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(FINDINGS_OPEN_KEY) !== 'false'
    } catch {
      return true
    }
  })
  const set = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(FINDINGS_OPEN_KEY, String(next))
    } catch {
      /* preference just won't persist */
    }
  }
  return [open, set]
}

function Viva({ uid, attemptId }: { uid: string; attemptId: string }) {
  const v = useViva(uid, attemptId)
  const [text, setText] = useState('')
  const [findingsOpen, setFindingsOpen] = useFindingsOpen()
  const { attempt, status } = v

  // The transcript has its own scrolling region and follows the newest message.
  const scroller = useRef<HTMLDivElement>(null)
  const scrollKey = `${attempt?.transcript.length ?? 0}-${attempt?.revision ? 1 : 0}-${status}`
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [scrollKey])

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
    <div
      className={`grid gap-4 p-4 lg:h-screen lg:overflow-hidden ${
        findingsOpen ? 'lg:grid-cols-[minmax(260px,1fr)_2fr_minmax(240px,1fr)]' : 'lg:grid-cols-[minmax(260px,1fr)_2fr_auto]'
      }`}
    >
      {/* Left: history, always on screen */}
      <aside className="lg:min-h-0 lg:overflow-y-auto">
        <HistoryCard viva={viva} />
      </aside>

      {/* Centre: status, conversation (own scroll region), controls docked underneath */}
      <main className="flex min-h-0 flex-col gap-3">
        <header>
          <Link to="/" className="text-sm text-indigo-900 underline">← Your attempts</Link>
          <h1 className="text-xl font-semibold">{viva.title}</h1>
          <p className="text-sm text-slate-600">{stageHint}</p>
        </header>

        {(!complete || status === 'reviewing') && <StatusIndicator status={status} />}

        <div ref={scroller} className="max-h-[55vh] min-h-0 flex-1 overflow-y-auto rounded-xl bg-white p-4 shadow-sm lg:max-h-none">
          <Transcript entries={attempt.transcript} />
          {attempt.revision && (
            <div className="mt-4">
              <RevisionPanel revision={attempt.revision} />
            </div>
          )}
          {complete && !attempt.revision && status !== 'reviewing' && (
            <button onClick={() => void v.begin()} className="mt-4 rounded bg-indigo-900 px-4 py-2 text-white">
              Generate revision point
            </button>
          )}
        </div>

        {!complete && (
          <section className="space-y-2">
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
                  className={`w-full select-none touch-none rounded-xl py-4 text-lg font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300 ${status === 'listening' ? 'bg-red-600' : 'bg-emerald-700'}`}
                >
                  {status === 'listening' ? 'Release to send' : 'Hold to speak (or Space)'}
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
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {attempt.stage === 'findings' && (
                    <button onClick={() => void v.moveToDiagnosis()} disabled={status !== 'idle'} className="rounded border border-indigo-900 px-3 py-1 text-indigo-900 disabled:opacity-40">
                      Give my diagnosis
                    </button>
                  )}
                  <button onClick={() => void v.repeatLast()} disabled={status !== 'idle'} className="rounded border px-3 py-1 disabled:opacity-40">
                    Repeat last
                  </button>
                  {attempt.timings.length > 0 && (
                    <span className="ml-auto text-xs text-slate-500">
                      Last voice turn: {Math.round(attempt.timings.at(-1)!.totalMs)} ms
                    </span>
                  )}
                </div>
              </>
            )}
            {v.error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{v.error}</p>}
          </section>
        )}
      </main>

      {/* Right: revealed findings, collapsible */}
      <aside className="lg:min-h-0 lg:overflow-y-auto">
        {findingsOpen ? (
          <FindingsPanel findings={attempt.revealed} onCollapse={() => setFindingsOpen(false)} />
        ) : (
          <button
            onClick={() => setFindingsOpen(true)}
            aria-label={`Show findings (${attempt.revealed.length})`}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-3 text-sm font-semibold shadow-sm hover:bg-indigo-50 lg:h-full lg:w-12 lg:flex-col lg:py-4"
          >
            <span aria-hidden>⇤</span>
            <span className="lg:[writing-mode:vertical-rl]">Findings ({attempt.revealed.length})</span>
          </button>
        )}
      </aside>
    </div>
  )
}
