import React, { useState, useEffect, useCallback } from 'react'
import { fetchGroceryLists, createGroceryList, updateGroceryList, deleteGroceryList } from '../../api'
import { LIST_STATUS_CLS, LIST_STATUS_LABEL, listSummary } from './helpers'
import GroceryListPanel from './GroceryListPanel'
import GroceryListDetail from './GroceryListDetail'

const STATUS_FILTERS = [
  { id: '',          label: 'All' },
  { id: 'draft',     label: 'Draft' },
  { id: 'active',    label: 'Active' },
  { id: 'completed', label: 'Completed' },
]

export default function GroceryLists({ stores, catalogItems }) {
  const [lists, setLists]             = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId]   = useState(null)
  const [panel, setPanel]             = useState({ open: false, mode: 'create', list: null })
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchGroceryLists()
      setLists(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = statusFilter
    ? lists.filter(l => l.status === statusFilter)
    : lists

  const selectedList = lists.find(l => l.id === selectedId) ?? null

  async function handleCreate(payload) {
    const created = await createGroceryList(payload)
    setLists(prev => [created, ...prev])
    setPanel({ open: false, mode: 'create', list: null })
  }

  async function handleUpdate(payload) {
    const updated = await updateGroceryList(panel.list.id, payload)
    setLists(prev => prev.map(l => l.id === updated.id ? updated : l))
    setPanel({ open: false, mode: 'create', list: null })
  }

  async function handleDelete(list) {
    if (!window.confirm(`Delete "${list.name}"?`)) return
    try {
      await deleteGroceryList(list.id)
      setLists(prev => prev.filter(l => l.id !== list.id))
      if (selectedId === list.id) setSelectedId(null)
    } catch (err) {
      setError(err.message)
    }
  }

  function handleListChanged(updated) {
    setLists(prev => prev.map(l => l.id === updated.id ? updated : l))
  }

  if (selectedList) {
    return (
      <GroceryListDetail
        list={selectedList}
        catalogItems={catalogItems}
        onBack={() => setSelectedId(null)}
        onListChanged={handleListChanged}
      />
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${statusFilter === f.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          ↺ Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 rounded-xl
          bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60
          text-red-700 dark:text-red-400 text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="flex-shrink-0 text-lg leading-none">✕</button>
        </div>
      )}

      {loading && (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm animate-pulse">
          Loading lists…
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm italic">
          {statusFilter ? `No ${statusFilter} lists.` : 'No shopping lists yet.'}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="space-y-2">
          {visible.map(list => (
            <ListCard
              key={list.id}
              list={list}
              onOpen={() => setSelectedId(list.id)}
              onEdit={() => setPanel({ open: true, mode: 'edit', list })}
              onDelete={() => handleDelete(list)}
            />
          ))}
        </div>
      )}

      {/* Create panel */}
      <GroceryListPanel
        open={panel.open}
        mode={panel.mode}
        list={panel.list}
        stores={stores}
        onClose={() => setPanel(p => ({ ...p, open: false }))}
        onSave={panel.mode === 'create' ? handleCreate : handleUpdate}
      />

      {/* FAB */}
      <button
        onClick={() => setPanel({ open: true, mode: 'create', list: null })}
        title="New shopping list"
        className="fixed bottom-6 right-6 z-40
          w-14 h-14 rounded-full
          bg-white dark:bg-slate-800
          border border-slate-200 dark:border-slate-700
          text-slate-600 dark:text-slate-300
          shadow-md hover:shadow-lg
          hover:bg-slate-50 dark:hover:bg-slate-700
          hover:border-slate-300 dark:hover:border-slate-600
          transition-all duration-200 active:scale-95
          flex items-center justify-center text-2xl leading-none select-none"
      >
        +
      </button>
    </div>
  )
}

function ListCard({ list, onOpen, onEdit, onDelete }) {
  const { total, done } = listSummary(list.items)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div
      onClick={onOpen}
      className="card cursor-pointer hover:shadow-md transition-shadow group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
              {list.name}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LIST_STATUS_CLS[list.status]}`}>
              {LIST_STATUS_LABEL[list.status]}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-400 dark:text-slate-500 flex-wrap">
            {list.store && <span>🏪 {list.store.name}</span>}
            {list.shopping_date && <span>📅 {list.shopping_date}</span>}
            <span>{total} item{total !== 1 ? 's' : ''}{total > 0 ? ` · ${done} purchased` : ''}</span>
          </div>
          {total > 0 && (
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden w-48 max-w-full">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onEdit}
            title="Edit list"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors text-sm"
          >✎</button>
          <button
            onClick={onDelete}
            title="Delete list"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-sm"
          >✕</button>
        </div>
      </div>
    </div>
  )
}
