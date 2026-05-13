'use client'
import { useCallback, useEffect, useState } from 'react'
import { fetchOccurrences, fetchCategories, updateOccurrence, createTaskFromOccurrence } from '@/lib/api'

interface OccurrenceCategory {
  name: string
}

interface OccurrenceEvent {
  title: string
  category?: OccurrenceCategory
  priority?: string
}

interface Occurrence {
  id: number
  occurrence_date: string
  status: string
  event?: OccurrenceEvent
}

interface ApiCategory {
  id: number
  name: string
  icon: string
  color: string
}

function today(): string { return new Date().toISOString().slice(0, 10) }

function daysOut(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmt(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function daysUntil(dateStr: string): string {
  const diff = Math.round((new Date(dateStr + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0)  return `${Math.abs(diff)}d ago`
  return `in ${diff}d`
}

const PRIORITY_CLASS: Record<string, string> = {
  high:   'priority-high',
  medium: 'priority-medium',
  low:    'priority-low',
}

export default function OccurrenceList() {
  const [occs, setOccs]             = useState<Occurrence[]>([])
  const [cats, setCats]             = useState<ApiCategory[]>([])
  const [loading, setLoading]       = useState(true)
  const [taskedIds, setTaskedIds]   = useState<Set<number>>(new Set())
  const [catFilter, setCatFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('upcoming,overdue')
  const [days, setDays]             = useState(60)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { start_date: today(), end_date: daysOut(days) }
      if (catFilter) params.category_id = catFilter
      const data: Occurrence[] = await fetchOccurrences(params)
      const statuses = statusFilter ? statusFilter.split(',') : []
      setOccs(statuses.length ? data.filter(o => statuses.includes(o.status)) : data)
    } catch (e) {
      console.error('Failed to load occurrences:', e)
    } finally {
      setLoading(false)
    }
  }, [catFilter, statusFilter, days])

  useEffect(() => { fetchCategories().then(setCats) }, [])
  useEffect(() => { load() }, [load])

  const mark = async (occ: Occurrence, status: string) => {
    try {
      const updated: Occurrence = await updateOccurrence(occ.id, { status })
      setOccs(prev => prev.map(o => o.id === updated.id ? updated : o))
    } catch (e) {
      console.error('Failed to update occurrence:', e)
    }
  }

  const makeTask = async (occ: Occurrence) => {
    await createTaskFromOccurrence(occ.id)
    setTaskedIds(prev => new Set(prev).add(occ.id))
  }

  const statusCounts = occs.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1
    return acc
  }, {})

  const btnCls = `inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
    border border-transparent transition-colors cursor-pointer`

  return (
    <div className="card">
      <div className="toolbar">
        <label>
          Category&nbsp;
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">All</option>
            {cats.map(c => (
              <option key={c.id} value={c.id}>{c.icon} {c.name.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
        <label>
          Status&nbsp;
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="upcoming,overdue">Upcoming + Overdue</option>
            <option value="upcoming">Upcoming</option>
            <option value="overdue">Overdue</option>
            <option value="completed">Completed</option>
            <option value="">All</option>
          </select>
        </label>
        <label>
          Days ahead&nbsp;
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={30}>30</option>
            <option value={60}>60</option>
            <option value={90}>90</option>
            <option value={180}>180</option>
            <option value={365}>365</option>
          </select>
        </label>
        <button className="btn btn-blue" onClick={load} title="Reload occurrences from the server">Refresh</button>

        {!loading && occs.length > 0 && (
          <span className="ml-auto text-[.8rem] text-[var(--color-text-dim)] flex gap-2 flex-wrap items-center">
            {Object.entries(statusCounts).map(([s, n]) => (
              <span key={s} className={`status ${s}`}>{n} {s}</span>
            ))}
          </span>
        )}
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : occs.length === 0 ? (
        <div className="empty">No occurrences found.</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead className="sticky top-0 z-10">
              <tr>
                <th>Date</th>
                <th>When</th>
                <th>Event</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {occs.map(occ => (
                <tr key={occ.id}>
                  <td className="whitespace-nowrap">{fmt(occ.occurrence_date)}</td>
                  <td className="whitespace-nowrap text-[var(--color-text-dim)]">{daysUntil(occ.occurrence_date)}</td>
                  <td>{occ.event?.title}</td>
                  <td>
                    <span
                      className="badge"
                      style={{ background: cats.find(c => c.name === occ.event?.category?.name)?.color ?? '#9ca3af' }}
                    >
                      {occ.event?.category?.name?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="capitalize">
                    <span className={`text-[.8rem] font-semibold ${PRIORITY_CLASS[occ.event?.priority ?? ''] ?? ''}`}>
                      {occ.event?.priority ?? '—'}
                    </span>
                  </td>
                  <td><span className={`status ${occ.status}`}>{occ.status}</span></td>
                  <td>
                    <div className="flex gap-1.5 flex-nowrap">
                      {occ.status !== 'completed' && (
                        <button
                          className="btn btn-green"
                          title="Mark as completed"
                          onClick={() => mark(occ, 'completed')}
                        >
                          ✓ Done
                        </button>
                      )}
                      {occ.status !== 'skipped' && (
                        <button
                          className="btn btn-gray"
                          title="Mark as skipped"
                          onClick={() => mark(occ, 'skipped')}
                        >
                          Skip
                        </button>
                      )}
                      {(occ.status === 'completed' || occ.status === 'skipped') && (
                        <button
                          className="btn btn-blue"
                          title="Reopen as upcoming"
                          onClick={() => mark(occ, 'upcoming')}
                        >
                          ↩ Reopen
                        </button>
                      )}
                      {(occ.status === 'upcoming' || occ.status === 'overdue') && (
                        taskedIds.has(occ.id)
                          ? <span className="text-xs text-emerald-400 px-2 py-1.5">✓ Task created</span>
                          : (
                            <button
                              className="btn btn-purple"
                              title="Create a task from this occurrence"
                              onClick={() => makeTask(occ)}
                            >
                              → Task
                            </button>
                          )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
