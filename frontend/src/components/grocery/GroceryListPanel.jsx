import React, { useState, useEffect, useRef } from 'react'

const fieldCls = `w-full px-3 py-2 text-sm rounded-lg
  bg-white dark:bg-slate-800
  border border-slate-200 dark:border-slate-700
  text-slate-800 dark:text-slate-200
  placeholder-slate-400 dark:placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-blue-500/50
  transition-shadow`

const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5'

export default function GroceryListPanel({ open, mode, list, stores, onClose, onSave }) {
  const isCreate = mode === 'create'
  const [form, setForm]   = useState({})
  const [saving, setSaving] = useState(false)
  const nameRef = useRef(null)

  useEffect(() => {
    if (!open) return
    if (isCreate) {
      setForm({ name: '', store_id: '', status: 'draft', shopping_date: '' })
    } else if (list) {
      setForm({
        name:          list.name ?? '',
        store_id:      list.store_id != null ? String(list.store_id) : '',
        status:        list.status ?? 'draft',
        shopping_date: list.shopping_date ?? '',
      })
    }
  }, [open, list, isCreate])

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handle(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  function set(field, value) { setForm(p => ({ ...p, [field]: value })) }

  async function handleSave() {
    if (!form.name.trim()) { nameRef.current?.focus(); return }
    setSaving(true)
    const payload = {
      name:          form.name.trim(),
      store_id:      form.store_id ? parseInt(form.store_id, 10) : null,
      status:        form.status,
      shopping_date: form.shopping_date || null,
    }
    try { await onSave(payload) } finally { setSaving(false) }
  }

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 dark:bg-black/60 z-40 transition-opacity duration-300
          ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div className={`fixed top-0 right-0 h-full w-[420px] max-w-full z-50
        bg-white dark:bg-slate-900
        border-l border-slate-200 dark:border-slate-700/60
        shadow-2xl flex flex-col
        transition-transform duration-300 ease-in-out
        ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {isCreate ? 'New Shopping List' : 'Edit List'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className={labelCls}>List Name <span className="text-red-500 normal-case tracking-normal">*</span></label>
            <input
              ref={nameRef}
              value={form.name ?? ''}
              onChange={e => set('name', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Weekly ALDI Run"
              className={fieldCls}
            />
          </div>

          <div>
            <label className={labelCls}>Store</label>
            <select value={form.store_id ?? ''} onChange={e => set('store_id', e.target.value)} className={fieldCls}>
              <option value="">— Any store —</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.location ? ` — ${s.location}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status ?? 'draft'} onChange={e => set('status', e.target.value)} className={fieldCls}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Shopping Date</label>
              <input
                type="date"
                value={form.shopping_date ?? ''}
                onChange={e => set('shopping_date', e.target.value)}
                className={fieldCls}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={saving || !form.name?.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold
              bg-blue-600 hover:bg-blue-500 text-white
              disabled:opacity-50 disabled:cursor-not-allowed
              shadow-sm shadow-blue-500/25 transition-all active:scale-[0.98]"
          >
            {saving ? 'Saving…' : isCreate ? 'Create List' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-medium
              bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300
              hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
