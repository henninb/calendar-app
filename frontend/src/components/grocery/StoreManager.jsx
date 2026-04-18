import React, { useState } from 'react'
import { createStore, updateStore, deleteStore } from '../../api'

const fieldCls = `px-2.5 py-1.5 text-sm rounded-lg
  bg-white dark:bg-slate-800
  border border-slate-200 dark:border-slate-700
  text-slate-800 dark:text-slate-200
  focus:outline-none focus:ring-2 focus:ring-blue-500/50
  transition-shadow`

const EMPTY = { name: '', location: '' }

export default function StoreManager({ stores, onStoresChange }) {
  const [editingId, setEditingId]   = useState(null)
  const [editForm, setEditForm]     = useState({})
  const [showNew, setShowNew]       = useState(false)
  const [newForm, setNewForm]       = useState(EMPTY)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)

  async function handleCreate() {
    if (!newForm.name.trim()) return
    setSaving(true)
    try {
      await createStore({ name: newForm.name.trim(), location: newForm.location.trim() || null })
      setNewForm(EMPTY)
      setShowNew(false)
      onStoresChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit(id) {
    setSaving(true)
    try {
      await updateStore(id, { name: editForm.name.trim(), location: editForm.location.trim() || null })
      setEditingId(null)
      onStoresChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(store) {
    if (!window.confirm(`Delete store "${store.name}"?`)) return
    try {
      await deleteStore(store.id)
      onStoresChange()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(store) {
    setEditingId(store.id)
    setEditForm({ name: store.name, location: store.location ?? '' })
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => setShowNew(v => !v)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          + Add Store
        </button>
      </div>

      {showNew && (
        <div className="card mb-4">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            New Store
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[140px]">
              <input
                autoFocus
                value={newForm.name}
                onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Store name (e.g. ALDI)"
                className={`${fieldCls} w-full`}
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <input
                value={newForm.location}
                onChange={e => setNewForm(p => ({ ...p, location: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Location (optional)"
                className={`${fieldCls} w-full`}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !newForm.name.trim()}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {saving ? '…' : 'Save'}
            </button>
            <button
              onClick={() => { setShowNew(false); setNewForm(EMPTY) }}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 rounded-xl
          bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60
          text-red-700 dark:text-red-400 text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="flex-shrink-0 text-lg leading-none">✕</button>
        </div>
      )}

      {stores.length === 0 ? (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm italic">
          No stores yet. Add one above.
        </div>
      ) : (
        <div className="card">
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Location</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stores.map(store => (
                  editingId === store.id ? (
                    <tr key={store.id}>
                      <td>
                        <input
                          autoFocus
                          value={editForm.name}
                          onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(store.id); if (e.key === 'Escape') setEditingId(null) }}
                          className="px-2 py-1 text-sm rounded-lg border border-blue-500 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none w-full"
                        />
                      </td>
                      <td>
                        <input
                          value={editForm.location}
                          onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(store.id); if (e.key === 'Escape') setEditingId(null) }}
                          className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none w-full"
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleSaveEdit(store.id)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-white transition-colors">Save</button>
                          <button onClick={() => setEditingId(null)} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={store.id} className="group">
                      <td className="font-medium text-slate-800 dark:text-slate-100">{store.name}</td>
                      <td className="text-slate-400 dark:text-slate-500 text-sm">{store.location ?? '—'}</td>
                      <td>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(store)}
                            title="Edit store"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors text-sm"
                          >✎</button>
                          <button
                            onClick={() => handleDelete(store)}
                            title="Delete store"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-sm"
                          >✕</button>
                        </div>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
