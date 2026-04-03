import React, { useEffect, useState } from 'react'
import { fetchOccurrences, fetchCategories, updateOccurrence } from '../api'


function today() { return new Date().toISOString().slice(0, 10) }
function daysOut(n) {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}
function daysUntil(dateStr) {
  const diff = Math.round((new Date(dateStr + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0)  return `${Math.abs(diff)}d ago`
  return `in ${diff}d`
}

export default function OccurrenceList() {
  const [occs, setOccs]       = useState([])
  const [cats, setCats]       = useState([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('upcoming,overdue')
  const [days, setDays]       = useState(60)

  const load = async () => {
    setLoading(true)
    const params = { start_date: today(), end_date: daysOut(days) }
    if (catFilter)    params.category_id = catFilter
    const data = await fetchOccurrences(params)
    // client-side status filter (multi-value)
    const statuses = statusFilter ? statusFilter.split(',') : []
    setOccs(statuses.length ? data.filter(o => statuses.includes(o.status)) : data)
    setLoading(false)
  }

  useEffect(() => { fetchCategories().then(setCats) }, [])
  useEffect(() => { load() }, [catFilter, statusFilter, days])

  const mark = async (occ, status) => {
    const updated = await updateOccurrence(occ.id, { status })
    setOccs(prev => prev.map(o => o.id === updated.id ? updated : o))
  }

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
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : occs.length === 0 ? (
        <div className="empty">No occurrences found.</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
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
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(occ.occurrence_date)}</td>
                  <td style={{ whiteSpace: 'nowrap', color: '#64748b' }}>{daysUntil(occ.occurrence_date)}</td>
                  <td>{occ.event?.title}</td>
                  <td>
                    <span
                      className="badge"
                      style={{ background: cats.find(c => c.name === occ.event?.category?.name)?.color ?? '#9ca3af' }}
                    >
                      {occ.event?.category?.name?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ textTransform: 'capitalize', color: '#64748b' }}>
                    {occ.event?.priority}
                  </td>
                  <td><span className={`status ${occ.status}`}>{occ.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: '.35rem' }}>
                      {occ.status !== 'completed' && (
                        <button className="btn btn-green" title="Mark this occurrence as completed" onClick={() => mark(occ, 'completed')}>✓</button>
                      )}
                      {occ.status !== 'skipped' && (
                        <button className="btn btn-gray" title="Mark this occurrence as skipped" onClick={() => mark(occ, 'skipped')}>Skip</button>
                      )}
                      {(occ.status === 'completed' || occ.status === 'skipped') && (
                        <button className="btn btn-blue" title="Reopen this occurrence as upcoming" onClick={() => mark(occ, 'upcoming')}>↩</button>
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
