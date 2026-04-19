import React, { useState, useEffect, useRef } from 'react'
import { createStore, updateStore, deleteStore } from '../../api'

const fieldCls = `px-2.5 py-1.5 text-sm rounded-lg
  bg-white dark:bg-slate-800
  border border-slate-200 dark:border-slate-700
  text-slate-800 dark:text-slate-200
  focus:outline-none focus:ring-2 focus:ring-blue-500/50
  transition-shadow`

const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5'

const EMPTY = { name: '', location: '' }

export default function StoreManager({ stores, onStoresChange }) {
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm]   = useState({})
  const [panelOpen, setPanelOpen] = useState(false)
  const [newForm, setNewForm]     = useState(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  async function handleCreate() {
    if (!newForm.name.trim()) return
    setSaving(true)
    try {
      await createStore({ name: newForm.name.trim(), location: newForm.location.trim() || null })
      setNewForm(EMPTY)
      setPanelOpen(false)
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
          No stores yet. Use the + button to add one.
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

      <AddStorePanel
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setNewForm(EMPTY) }}
        newForm={newForm}
        setNewForm={setNewForm}
        onSave={handleCreate}
        saving={saving}
      />

      {/* FAB — add store */}
      <button
        onClick={() => setPanelOpen(true)}
        title="Add store"
        className="fixed bottom-6 right-6 z-40
          w-14 h-14 rounded-full
          bg-white dark:bg-slate-800
          border border-slate-200 dark:border-slate-700
          text-slate-600 dark:text-slate-300
          shadow-md hover:shadow-lg
          hover:bg-slate-50 dark:hover:bg-slate-700
          hover:border-slate-300 dark:hover:border-slate-600
          transition-all duration-200 active:scale-95
          flex items-center justify-center
          text-2xl leading-none select-none"
      >
        +
      </button>
    </div>
  )
}

function AddStorePanel({ open, onClose, newForm, setNewForm, onSave, saving }) {
  const nameRef = useRef(null)

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handle(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 dark:bg-black/60 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 right-0 h-full w-[400px] max-w-full z-50
          bg-white dark:bg-slate-900
          border-l border-slate-200 dark:border-slate-700/60
          shadow-2xl flex flex-col
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">New Store</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className={labelCls}>Name <span className="text-red-500 normal-case tracking-normal">*</span></label>
            <input
              ref={nameRef}
              value={newForm.name}
              onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && onSave()}
              placeholder="e.g. ALDI"
              className={`${fieldCls} w-full`}
            />
          </div>
          <div>
            <label className={labelCls}>Location</label>
            <input
              value={newForm.location}
              onChange={e => setNewForm(p => ({ ...p, location: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && onSave()}
              placeholder="Optional"
              className={`${fieldCls} w-full`}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <button
            onClick={onSave}
            disabled={saving || !newForm.name.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold
              bg-blue-600 hover:bg-blue-500 text-white
              disabled:opacity-50 disabled:cursor-not-allowed
              shadow-sm shadow-blue-500/25
              transition-all active:scale-[0.98]"
          >
            {saving ? 'Saving…' : 'Save Store'}
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
