import React, { useEffect, useState } from 'react'
import { fetchCreditCardTracker } from '../api'

function fmt(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function DaysCell({ dateStr, days }) {
  if (!dateStr) return <td>—</td>
  let cls = ''
  if (days <= 3)  cls = 'cc-overdue'
  else if (days <= 7) cls = 'cc-soon'
  return (
    <td className={cls}>
      {fmt(dateStr)}{' '}
      <span style={{ fontSize: '.78rem', color: cls ? undefined : '#94a3b8' }}>
        ({days}d)
      </span>
    </td>
  )
}

export default function CreditCardTracker() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCreditCardTracker()
      .then(setRows)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading…</div>
  if (!rows.length) return <div className="empty">No credit cards found. Add cards via the API.</div>

  return (
    <div className="card">
      <div style={{ marginBottom: '.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Credit Card Billing Tracker</h2>
        <button className="btn btn-blue" onClick={() => fetchCreditCardTracker().then(setRows)} title="Reload credit card billing dates from the server">
          Refresh
        </button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th>Issuer</th>
              <th>Grace</th>
              <th>Last Close</th>
              <th>Prev Due</th>
              <th>Next Close</th>
              <th>Next Due</th>
              <th>Annual Fee</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {row.name}
                  {row.last_four && (
                    <span style={{ color: '#94a3b8', marginLeft: '.4rem', fontSize: '.8rem' }}>
                      ({row.last_four})
                    </span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', color: '#475569' }}>{row.issuer}</td>
                <td style={{ textAlign: 'center' }}>{row.grace}</td>
                <td>{fmt(row.prev_close)}</td>
                <td className={row.prev_due_overdue ? 'cc-overdue' : ''}>
                  {fmt(row.prev_due)}
                  {row.prev_due_overdue && (
                    <span style={{ marginLeft: '.3rem', fontSize: '.75rem' }}>⚠</span>
                  )}
                </td>
                <DaysCell dateStr={row.next_close} days={row.next_close_days} />
                <DaysCell dateStr={row.next_due}   days={row.next_due_days} />
                <DaysCell dateStr={row.annual_fee_date} days={row.annual_fee_days} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '.75rem', fontSize: '.78rem', color: '#94a3b8' }}>
        Dates highlighted in <span style={{ color: '#d97706', fontWeight: 600 }}>orange</span> are
        due within 7 days. <span style={{ color: '#dc2626', fontWeight: 600 }}>Red</span> = 3 days or fewer.
      </p>
    </div>
  )
}
