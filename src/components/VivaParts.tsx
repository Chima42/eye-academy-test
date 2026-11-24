import type { CaseFile, RevealedFinding } from '../case/types'
import type { RevisionPoint, TranscriptEntry } from '../viva/attempt'
import type { TurnStatus } from '../viva/useViva'

const STATUS: Record<TurnStatus, { label: string; hint: string; icon: string; className: string }> = {
  not_started: { label: 'Ready when you are', hint: 'Press Start to hear the examiner', icon: '▶', className: 'bg-slate-100 text-slate-700 border-slate-300' },
  idle: { label: 'Your turn', hint: 'Hold the button (or Space) and speak', icon: '🎙', className: 'bg-emerald-50 text-emerald-900 border-emerald-400' },
  listening: { label: 'Listening…', hint: 'Release when you have finished speaking', icon: '●', className: 'bg-red-50 text-red-900 border-red-500' },
  thinking: { label: 'Examiner thinking…', hint: 'Please wait', icon: '…', className: 'bg-amber-50 text-amber-900 border-amber-400' },
  speaking: { label: 'Examiner speaking', hint: 'Please wait until the examiner finishes', icon: '🔊', className: 'bg-indigo-50 text-indigo-900 border-indigo-400' },
  reviewing: { label: 'Preparing your revision point…', hint: 'Searching the reference note', icon: '📖', className: 'bg-indigo-50 text-indigo-900 border-indigo-400' },
}

/** Whose turn it is, shown with colour, text and an icon (never colour alone). */
export function StatusIndicator({ status }: { status: TurnStatus }) {
  const s = STATUS[status]
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-4 rounded-xl border-2 px-5 py-4 ${s.className}`}>
      <span aria-hidden className={`text-3xl ${status === 'listening' ? 'animate-pulse' : ''}`}>{s.icon}</span>
      <div>
        <p className="text-xl font-semibold">{s.label}</p>
        <p className="text-sm opacity-80">{s.hint}</p>
      </div>
    </div>
  )
}

export function HistoryCard({ viva }: { viva: CaseFile }) {
  const p = viva.patient
  const rows: [string, string][] = [
    ['Presenting complaint', p.presenting_complaint],
    ['Past ocular history', p.past_ocular_history],
    ['Past medical history', p.past_medical_history],
    ['Medications', p.medications.join('; ')],
    ['Allergies', p.allergies],
    ['Family history', p.family_history],
  ]
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="mb-2 font-semibold">History</h2>
      <p className="mb-3 text-sm text-slate-600">{p.age}-year-old {p.sex}</p>
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium text-slate-700">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function FindingsPanel({ findings }: { findings: RevealedFinding[] }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="mb-2 font-semibold">Findings revealed ({findings.length})</h2>
      {findings.length === 0 ? (
        <p className="text-sm text-slate-500">Ask the examiner for examination findings.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {findings.map((f) => (
            <li key={f.id} className={`rounded border-l-4 px-3 py-2 ${f.available ? 'border-emerald-500 bg-emerald-50' : 'border-slate-400 bg-slate-100 text-slate-600'}`}>
              {f.display}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="mb-2 font-semibold">Transcript</h2>
      <ol className="space-y-3 text-sm">
        {entries.map((e, i) => (
          <li key={i} className={e.role === 'examiner' ? 'pr-8' : 'pl-8 text-right'}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {e.role === 'examiner' ? 'Examiner' : e.source === 'voice' ? 'You · Heard' : 'You · Typed'}
            </p>
            <p className={`inline-block rounded-lg px-3 py-2 ${e.role === 'examiner' ? 'bg-indigo-50' : 'bg-slate-100'}`}>{e.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function RevisionPanel({ revision }: { revision: RevisionPoint }) {
  return (
    <section className="rounded-xl border-2 border-indigo-300 bg-white p-4 shadow-sm">
      <h2 className="mb-1 font-semibold">Revision point</h2>
      <p className="mb-3 text-sm text-slate-600">Focus: {revision.gap}</p>
      {revision.status === 'supported' ? (
        <>
          <p className="mb-3">{revision.point}</p>
          <blockquote className="border-l-4 border-indigo-400 bg-indigo-50 px-3 py-2 text-sm italic">
            “{revision.excerpt}”
            <footer className="mt-1 not-italic font-medium">Reference note, page {revision.page}</footer>
          </blockquote>
        </>
      ) : (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm">
          I couldn't find support for a revision point on this in the reference note. {revision.reason}
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Passages retrieved: {revision.retrieved.map((r) => `p${r.pages.join('–')} (${r.section})`).join('; ')}
      </p>
    </section>
  )
}
