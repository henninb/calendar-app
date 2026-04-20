import React, { useState, useEffect, useRef } from 'react'

const RRULE_OPTIONS = [
  { value: '',                         label: 'One-time' },
  { value: 'FREQ=DAILY',               label: 'Daily' },
  { value: 'FREQ=WEEKLY',              label: 'Weekly' },
  { value: 'FREQ=WEEKLY;INTERVAL=2',   label: 'Biweekly' },
  { value: 'FREQ=MONTHLY',             label: 'Monthly' },
  { value: 'FREQ=MONTHLY;INTERVAL=3',  label: 'Every 3 Months' },
  { value: 'FREQ=MONTHLY;INTERVAL=6',  label: 'Every 6 Months' },
  { value: 'FREQ=YEARLY',              label: 'Yearly' },
]

const fieldCls = `w-full px-3 py-2 text-sm rounded-lg
  bg-white dark:bg-slate-800
  border border-slate-200 dark:border-slate-700
  text-slate-800 dark:text-slate-200
  placeholder-slate-400 dark:placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-blue-500/50
  transition-shadow`

const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function EventPanel({ open, onClose, onCreateEvent, categories }) {
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const titleRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setForm({
      title: '',
      category_id: '',
      dtstart: today(),
      rrule: '',
      dtend_rule: '',
      duration_days: '1',
      description: '',
      amount: '',
    })
    setError(null)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => titleRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handle(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  function set(field, value) {
    setForm(p => ({ ...p, [field]: value }))
  }

  async function handleSave() {
    if (!form.title.trim()) { titleRef.current?.focus(); return }
    if (!form.category_id) { setError('Please select a category.'); return }
    if (!form.dtstart) { setError('Please set a start date.'); return }
    setSaving(true)
    setError(null)
    const payload = {
      title:         form.title.trim(),
      category_id:   parseInt(form.category_id, 10),
      dtstart:       form.dtstart,
      rrule:         form.rrule || null,
      dtend_rule:    form.dtend_rule || null,
      duration_days: Math.max(1, parseInt(form.duration_days, 10) || 1),
      description:   form.description.trim() || null,
      amount:        form.amount ? form.amount : null,
    }
    try {
      await onCreateEvent(payload)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const isRecurring = !!form.rrule

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 dark:bg-black/60 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 right-0 h-full w-[480px] max-w-full z-50
          bg-white dark:bg-slate-900
          border-l border-slate-200 dark:border-slate-700/60
          shadow-2xl flex flex-col
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">New Event</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className={labelCls}>Title <span className="text-red-500 normal-case tracking-normal">*</span></label>
            <input
              ref={titleRef}
              value={form.title ?? ''}
              onChange={e => set('title', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Event title"
              className={fieldCls}
            />
          </div>

          {/* Category */}
          <div>
            <label className={labelCls}>Category <span className="text-red-500 normal-case tracking-normal">*</span></label>
            <select value={form.category_id ?? ''} onChange={e => set('category_id', e.target.value)} className={fieldCls}>
              <option value="">Select category…</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {/* Start date + Duration side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date <span className="text-red-500 normal-case tracking-normal">*</span></label>
              <input
                type="date"
                value={form.dtstart ?? ''}
                onChange={e => set('dtstart', e.target.value)}
                className={fieldCls}
              />
            </div>
            <div>
              <label className={labelCls}>Duration (days)</label>
              <input
                type="number"
                min="1"
                value={form.duration_days ?? '1'}
                onChange={e => set('duration_days', e.target.value)}
                className={fieldCls}
              />
            </div>
          </div>

          {/* Recurrence */}
          <div>
            <label className={labelCls}>Recurrence</label>
            <select value={form.rrule ?? ''} onChange={e => set('rrule', e.target.value)} className={fieldCls}>
              {RRULE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {/* End date — only shown for recurring events */}
          {isRecurring && (
            <div>
              <label className={labelCls}>Repeat Until (optional)</label>
              <input
                type="date"
                value={form.dtend_rule ?? ''}
                onChange={e => set('dtend_rule', e.target.value)}
                className={fieldCls}
              />
            </div>
          )}

          {/* Description */}
          <div>
            <label className={labelCls}>Description</label>
            <textarea
              value={form.description ?? ''}
              onChange={e => set('description', e.target.value)}
              placeholder="Optional notes…"
              rows={3}
              className={`${fieldCls} resize-none`}
            />
          </div>

          {/* Amount */}
          <div>
            <label className={labelCls}>Amount ($)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount ?? ''}
              onChange={e => set('amount', e.target.value)}
              placeholder="—"
              className={fieldCls}
            />
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={saving || !form.title?.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold
              bg-blue-600 hover:bg-blue-500 text-white
              disabled:opacity-50 disabled:cursor-not-allowed
              shadow-sm shadow-blue-500/25
              transition-all active:scale-[0.98]"
          >
            {saving ? 'Creating…' : 'Create Event'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-medium
              bg-slate-100 dark:bg-slate-800
              text-slate-600 dark:text-slate-300
              hover:bg-slate-200 dark:hover:bg-slate-700
              transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
