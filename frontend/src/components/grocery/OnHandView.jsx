import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchOnHand, upsertOnHand, deleteOnHand,
  createGroceryItem, updateGroceryItem, deleteGroceryItem,
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
  const [onHand, setOnHand]           = useState([])
  const [search, setSearch]           = useState('')
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [editingId, setEditingId]     = useState(null)
  const [editForm, setEditForm]       = useState({})
  const [panelOpen, setPanelOpen]     = useState(false)
  const [newItem, setNewItem]         = useState(EMPTY_NEW_ITEM)
  const [savingNew, setSavingNew]     = useState(false)

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

  const onHandMap = Object.fromEntries(onHand.map(r => [r.item_id, r]))
  const rows = catalogItems
    .filter(item => !search || item.name.toLowerCase().includes(search.toLowerCase()))
    .map(item => ({ item, record: onHandMap[item.id] ?? null }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name))

  function startEdit(item, record) {
    setEditingId(item.id)
    setEditForm({
      name:             item.name,
      default_store_id: item.default_store_id != null ? String(item.default_store_id) : '',
      quantity:         record ? String(parseFloat(record.quantity)) : '0',
      unit:             record ? record.unit : item.default_unit,
    })
  }

  async function saveEdit(itemId) {
    try {
      await Promise.all([
        updateGroceryItem(itemId, {
          name:             editForm.name.trim(),
          default_store_id: editForm.default_store_id ? parseInt(editForm.default_store_id, 10) : null,
        }),
        upsertOnHand(itemId, {
          quantity: editForm.quantity || '0',
          unit:     editForm.unit,
        }),
      ])
      await Promise.all([onCatalogChange(), load()])
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
      setPanelOpen(false)
      onCatalogChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingNew(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          className={`${fieldCls} w-48`}
        />
      </div>

      <AddItemPanel
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setNewItem(EMPTY_NEW_ITEM) }}
        newItem={newItem}
        setNewItem={setNewItem}
        onSave={handleCreateItem}
        saving={savingNew}
        stores={stores}
      />

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
                    stores={stores}
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

      {/* FAB — add catalog item */}
      <button
        onClick={() => setPanelOpen(true)}
        title="Add catalog item"
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

function AddItemPanel({ open, onClose, newItem, setNewItem, onSave, saving, stores }) {
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
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">New Catalog Item</h2>
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
              value={newItem.name}
              onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && onSave()}
              placeholder="e.g. Bone Broth"
              className={`${fieldCls} w-full`}
            />
          </div>
          <div>
            <label className={labelCls}>Default Unit</label>
            <select
              value={newItem.default_unit}
              onChange={e => setNewItem(p => ({ ...p, default_unit: e.target.value }))}
              className={`${fieldCls} w-full`}
            >
              {GROCERY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Default Store</label>
            <select
              value={newItem.default_store_id}
              onChange={e => setNewItem(p => ({ ...p, default_store_id: e.target.value }))}
              className={`${fieldCls} w-full`}
            >
              <option value="">— None —</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <button
            onClick={onSave}
            disabled={saving || !newItem.name.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold
              bg-blue-600 hover:bg-blue-500 text-white
              disabled:opacity-50 disabled:cursor-not-allowed
              shadow-sm shadow-blue-500/25
              transition-all active:scale-[0.98]"
          >
            {saving ? 'Saving…' : 'Save Item'}
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

function OnHandRow({ item, record, stores, isEditing, editForm, onEditFormChange, onStartEdit, onSaveEdit, onCancelEdit, onDelete }) {
  const qty   = record ? parseFloat(record.quantity) : 0
  const unit  = record ? record.unit : item.default_unit
  const isLow = qty === 0

  if (isEditing) {
    return (
      <tr>
        <td>
          <input
            autoFocus
            value={editForm.name ?? ''}
            onChange={e => onEditFormChange('name', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit() }}
            className="px-2 py-1 text-sm rounded-lg border border-blue-500 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none w-full min-w-[120px]"
          />
        </td>
        <td>
          <select
            value={editForm.default_store_id ?? ''}
            onChange={e => onEditFormChange('default_store_id', e.target.value)}
            className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none w-full"
          >
            <option value="">— None —</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </td>
        <td>
          <input
            type="number"
            min="0"
            step="0.001"
            value={editForm.quantity ?? ''}
            onChange={e => onEditFormChange('quantity', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit() }}
            className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none w-24"
          />
        </td>
        <td>
          <select
            value={editForm.unit ?? ''}
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
        onDoubleClick={onStartEdit}
        title="Double-click to edit"
        className="editable-cell font-medium text-slate-800 dark:text-slate-100 cursor-pointer"
      >{item.name}</td>
      <td
        onDoubleClick={onStartEdit}
        title="Double-click to edit"
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
            title="Edit item"
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
