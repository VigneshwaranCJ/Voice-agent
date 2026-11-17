import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="animate-rise mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[17px] leading-relaxed text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card">
      <div className="text-[13px] font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

const tones: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-100',
  gray: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: keyof typeof tones }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>
}

export function statusTone(s: string): keyof typeof tones {
  return ({ completed: 'green', indexed: 'green', escalated: 'red', failed: 'red', active: 'blue', abandoned: 'amber', pending: 'amber' } as const)[s as 'completed'] ?? 'gray'
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="mb-6 rounded-2xl bg-rose-50 px-5 py-3.5 text-sm text-rose-700">{error}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-slate-50 p-10 text-center text-sm text-slate-500">{children}</div>
}

export function fmtDate(s: string | null | undefined) {
  return s ? new Date(s.endsWith('Z') || s.includes('+') ? s : `${s}Z`).toLocaleString() : '—'
}
