import React, { useEffect, useState } from 'react'
import { fetchCreditCardTracker, createCreditCard } from '../api'

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

const EMPTY_FORM = {
  name: '',
  issuer: '',
  last_four: '',
  statement_close_day: '',
  grace_period_days: '',
  weekend_shift: '',
  due_day_same_month: '',
  due_day_next_month: '',
  annual_fee_month: '',
}

export default function CreditCardTracker() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [adding, setAdding]   = useState(false)
  const [form, setForm]       = useState(EMPTY_FORM)
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState(null)

  const reload = () =>
    fetchCreditCardTracker()
      .then(setRows)
      .catch(e => setError(e.message))

  useEffect(() => {
    fetchCreditCardTracker()
      .then(setRows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    if (!form.name.trim()) { setFormError('Name is required.'); return }
    const payload = { name: form.name.trim() }
    if (form.issuer.trim())             payload.issuer              = form.issuer.trim()
    if (form.last_four.trim())          payload.last_four           = form.last_four.trim()
    if (form.statement_close_day !== '') payload.statement_close_day = Number(form.statement_close_day)
    if (form.grace_period_days !== '')  payload.grace_period_days   = Number(form.grace_period_days)
    if (form.weekend_shift)             payload.weekend_shift       = form.weekend_shift
    if (form.due_day_same_month !== '')  payload.due_day_same_month  = Number(form.due_day_same_month)
    if (form.due_day_next_month !== '')  payload.due_day_next_month  = Number(form.due_day_next_month)
    if (form.annual_fee_month !== '')    payload.annual_fee_month    = Number(form.annual_fee_month)
    setSaving(true)
    try {
      await createCreditCard(payload)
      setForm(EMPTY_FORM)
      setAdding(false)
      await reload()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="loading">Loading…</div>
  if (error)   return <div className="empty">Failed to load credit cards: {error}</div>

  return (
    <div className="card">
      <div style={{ marginBottom: '.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Credit Card Billing Tracker</h2>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-green" onClick={() => { setAdding(a => !a); setFormError(null) }}
            title="Add a new credit card">
            {adding ? 'Cancel' : '+ Add Card'}
          </button>
          <button className="btn btn-blue" onClick={reload} title="Reload credit card billing dates from the server">
            Refresh
          </button>
        </div>
      </div>

      {adding && (
        <form onSubmit={handleSubmit} style={{
          background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)', borderRadius: 8,
          padding: '1rem', marginBottom: '1rem',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.65rem .75rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Name <span style={{ color: '#dc2626' }}>*</span>
              <input value={form.name} onChange={set('name')} placeholder="e.g. Chase Sapphire"
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Issuer
              <input value={form.issuer} onChange={set('issuer')} placeholder="e.g. Chase"
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Last Four
              <input value={form.last_four} onChange={set('last_four')} placeholder="e.g. 1234" maxLength={4}
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Statement Close Day
              <input type="number" min={1} max={31} value={form.statement_close_day} onChange={set('statement_close_day')}
                placeholder="1–31"
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Grace Period (days)
              <input type="number" min={0} value={form.grace_period_days} onChange={set('grace_period_days')}
                placeholder="e.g. 25"
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Weekend Shift
              <select value={form.weekend_shift} onChange={set('weekend_shift')}
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }}>
                <option value="">None</option>
                <option value="back">Back (Sat/Sun → Friday)</option>
                <option value="forward">Forward (Sat/Sun → Monday)</option>
                <option value="back_sat_only">Back Sat only</option>
                <option value="nearest">Nearest weekday</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Due Day (same month)
              <input type="number" min={1} max={31} value={form.due_day_same_month} onChange={set('due_day_same_month')}
                placeholder="1–31"
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Due Day (next month)
              <input type="number" min={1} max={31} value={form.due_day_next_month} onChange={set('due_day_next_month')}
                placeholder="1–31"
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem', color: 'var(--color-text-muted)' }}>
              Annual Fee Month
              <input type="number" min={1} max={12} value={form.annual_fee_month} onChange={set('annual_fee_month')}
                placeholder="1–12"
                style={{ border: '1px solid var(--color-input-border)', borderRadius: 5, padding: '.3rem .5rem', fontSize: '.85rem', background: 'var(--color-input-bg)', color: 'var(--color-text)' }} />
            </label>
          </div>
          {formError && (
            <p style={{ color: '#dc2626', fontSize: '.82rem', marginTop: '.5rem' }}>{formError}</p>
          )}
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem' }}>
            <button type="submit" className="btn btn-green" disabled={saving}>
              {saving ? 'Saving…' : 'Save Card'}
            </button>
            <button type="button" className="btn btn-gray"
              onClick={() => { setAdding(false); setForm(EMPTY_FORM); setFormError(null) }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!rows.length ? (
        <div className="empty">No credit cards found. Use the Add Card button above.</div>
      ) : (
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
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>{row.issuer}</td>
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
      )}
      <p style={{ marginTop: '.75rem', fontSize: '.78rem', color: '#94a3b8' }}>
        Dates highlighted in <span style={{ color: '#d97706', fontWeight: 600 }}>orange</span> are
        due within 7 days. <span style={{ color: '#dc2626', fontWeight: 600 }}>Red</span> = 3 days or fewer.
      </p>
    </div>
  )
}
