import React, { useState, useEffect, useCallback, useId } from 'react'
import {
  fetchOnHand, upsertOnHand, deleteOnHand,
  createGroceryItem, deleteGroceryItem,
} from '../../api'
import { GROCERY_UNITS } from './helpers'

const fieldCls = `px-2.5 py-1.5 text-sm rounded-lg
  bg-white dark:bg-slate-800
  border border-slate-200 dark:border-slate-700
  text-slate-800 dark:text-slate-200
  focus:outline-none focus:ring-2 focus:ring-blue-500/50
  transition-shadow`

const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1'

const EMPTY_NEW_ITEM = { name: '', default_unit: 'each', default_store_id: '' }

export default function OnHandView({ catalogItems, stores, onCatalogChange }) {
  const [onHand, setOnHand]       = useState([])
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [editingId, setEditingId] = useState(null)  // item_id being edited
  const [editForm, setEditForm]   = useState({})
  const [showNewItem, setShowNewItem] = useState(false)
  const [newItem, setNewItem]     = useState(EMPTY_NEW_ITEM)
  const [savingNew, setSavingNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchOnHand()
      setOnHand(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Build a unified view: all catalog items, merged with on-hand quantities
  const onHandMap = Object.fromEntries(onHand.map(r => [r.item_id, r]))
  const rows = catalogItems
    .filter(item => !search || item.name.toLowerCase().includes(search.toLowerCase()))
    .map(item => ({ item, record: onHandMap[item.id] ?? null }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name))

  function startEdit(item, record) {
    setEditingId(item.id)
    setEditForm({
      quantity: record ? String(parseFloat(record.quantity)) : '0',
      unit:     record ? record.unit : item.default_unit,
    })
  }

  async function saveEdit(itemId) {
    try {
      const updated = await upsertOnHand(itemId, {
        quantity: editForm.quantity || '0',
        unit:     editForm.unit,
      })
      setOnHand(prev => {
        const idx = prev.findIndex(r => r.item_id === itemId)
        return idx >= 0 ? prev.map(r => r.item_id === itemId ? updated : r) : [...prev, updated]
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setEditingId(null)
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Remove "${item.name}" from the catalog? This will also delete it from all shopping lists.`)) return
    try {
      await deleteGroceryItem(item.id)
      onCatalogChange()
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleCreateItem() {
    if (!newItem.name.trim()) return
    setSavingNew(true)
    try {
      await createGroceryItem({
        name:             newItem.name.trim(),
        default_unit:     newItem.default_unit,
        default_store_id: newItem.default_store_id ? parseInt(newItem.default_store_id, 10) : null,
      })
      setNewItem(EMPTY_NEW_ITEM)
      setShowNewItem(false)
      onCatalogChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingNew(false)
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className={`${fieldCls} w-48`}
        />
        <button
          onClick={() => setShowNewItem(v => !v)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          + Add Item
        </button>
      </div>

      {/* New item form */}
      {showNewItem && (
        <div className="card mb-4">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            New Catalog Item
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className={labelCls}>Name *</label>
              <input
                autoFocus
                value={newItem.name}
                onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleCreateItem()}
                placeholder="e.g. Bone Broth"
                className={`${fieldCls} w-full`}
              />
            </div>
            <div>
              <label className={labelCls}>Default Unit</label>
              <select
                value={newItem.default_unit}
                onChange={e => setNewItem(p => ({ ...p, default_unit: e.target.value }))}
                className={`${fieldCls} w-28`}
              >
                {GROCERY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Default Store</label>
              <select
                value={newItem.default_store_id}
                onChange={e => setNewItem(p => ({ ...p, default_store_id: e.target.value }))}
                className={`${fieldCls} w-36`}
              >
                <option value="">— None —</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button
              onClick={handleCreateItem}
              disabled={savingNew || !newItem.name.trim()}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {savingNew ? '…' : 'Save'}
            </button>
            <button
              onClick={() => { setShowNewItem(false); setNewItem(EMPTY_NEW_ITEM) }}
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

      {loading && (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm animate-pulse">Loading…</div>
      )}

      {!loading && rows.length === 0 && (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm italic">
          {search ? 'No items match your search.' : 'No catalog items yet. Add one above.'}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="card">
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Default Store</th>
                  <th>On Hand</th>
                  <th>Unit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, record }) => (
                  <OnHandRow
                    key={item.id}
                    item={item}
                    record={record}
                    isEditing={editingId === item.id}
                    editForm={editForm}
                    onEditFormChange={(field, val) => setEditForm(p => ({ ...p, [field]: val }))}
                    onStartEdit={() => startEdit(item, record)}
                    onSaveEdit={() => saveEdit(item.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={() => handleDelete(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function OnHandRow({ item, record, isEditing, editForm, onEditFormChange, onStartEdit, onSaveEdit, onCancelEdit, onDelete }) {
  const qty = record ? parseFloat(record.quantity) : 0
  const unit = record ? record.unit : item.default_unit
  const isLow = qty === 0

  if (isEditing) {
    return (
      <tr>
        <td className="font-medium text-slate-800 dark:text-slate-100">{item.name}</td>
        <td className="text-slate-400 dark:text-slate-500 text-sm">{item.default_store?.name ?? '—'}</td>
        <td>
          <input
            autoFocus
            type="number"
            min="0"
            step="0.001"
            value={editForm.quantity}
            onChange={e => onEditFormChange('quantity', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit() }}
            className="px-2 py-1 text-sm rounded-lg border border-blue-500 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none w-24"
          />
        </td>
        <td>
          <select
            value={editForm.unit}
            onChange={e => onEditFormChange('unit', e.target.value)}
            className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none"
          >
            {GROCERY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </td>
        <td>
          <div className="flex items-center gap-1">
            <button onClick={onSaveEdit} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-white transition-colors">Save</button>
            <button onClick={onCancelEdit} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Cancel</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="group">
      <td
        onClick={onStartEdit}
        title="Click to edit"
        className="editable-cell font-medium text-slate-800 dark:text-slate-100 cursor-pointer"
      >{item.name}</td>
      <td
        onClick={onStartEdit}
        title="Click to edit"
        className="editable-cell text-slate-400 dark:text-slate-500 text-sm cursor-pointer"
      >{item.default_store?.name ?? '—'}</td>
      <td
        onClick={onStartEdit}
        title="Click to edit"
        className={`editable-cell text-sm font-mono ${isLow ? 'text-red-500 dark:text-red-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}`}
      >
        {qty % 1 === 0 ? qty : qty.toFixed(3).replace(/\.?0+$/, '')}
      </td>
      <td
        onClick={onStartEdit}
        title="Click to edit"
        className="editable-cell text-slate-400 dark:text-slate-500 text-sm cursor-pointer"
      >{unit}</td>
      <td>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onStartEdit}
            title="Edit on-hand quantity"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors text-sm"
          >✎</button>
          <button
            onClick={onDelete}
            title="Remove from catalog"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-sm"
          >✕</button>
        </div>
      </td>
    </tr>
  )
}
