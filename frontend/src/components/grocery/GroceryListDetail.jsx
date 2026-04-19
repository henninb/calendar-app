import React, { useState, useId, useCallback, useEffect, useRef } from 'react'
import {
  addGroceryListItem, updateGroceryListItem, removeGroceryListItem,
  updateGroceryList, fetchGroceryList,
} from '../../api'
import {
  GROCERY_UNITS, LIST_STATUS_CLS, LIST_STATUS_LABEL,
  NEXT_STATUS, NEXT_STATUS_LABEL, fmtQty, fmtPrice, listSummary,
} from './helpers'

const fieldCls = `px-2.5 py-1.5 text-sm rounded-lg
  bg-white dark:bg-slate-800
  border border-slate-200 dark:border-slate-700
  text-slate-800 dark:text-slate-200
  focus:outline-none focus:ring-2 focus:ring-blue-500/50
  transition-shadow`

const EMPTY_ADD = { item_id: '', quantity: '1', unit: 'each', price: '' }

const ItemCombobox = React.forwardRef(function ItemCombobox({ value, onChange, catalogItems }, ref) {
  const id = useId()
  const toText = useCallback(v => {
    const c = catalogItems.find(c => String(c.id) === String(v))
    return c ? c.name : ''
  }, [catalogItems])
  const [text, setText] = useState(() => toText(value))

  function handleChange(e) {
    const t = e.target.value
    setText(t)
    const match = catalogItems.find(c => c.name === t)
    if (match) onChange(String(match.id), match.default_unit)
    else if (!t) onChange('', 'each')
  }

  return (
    <>
      <input
        ref={ref}
        list={id}
        value={text}
        onChange={handleChange}
        onBlur={() => setText(toText(value))}
        placeholder="Search catalog…"
        autoComplete="off"
        className={`${fieldCls} w-full`}
      />
      <datalist id={id}>
        {catalogItems.map(c => <option key={c.id} value={c.name} />)}
      </datalist>
    </>
  )
})

export default function GroceryListDetail({ list: initialList, catalogItems, onBack, onListChanged }) {
  const [list, setList]         = useState(initialList)
  const [addForm, setAddForm]   = useState(EMPTY_ADD)
  const [adding, setAdding]     = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [error, setError]       = useState(null)

  // Re-sync if the parent passes a new list (e.g. after status change via panel)
  React.useEffect(() => { setList(initialList) }, [initialList])

  async function reload() {
    try {
      const fresh = await fetchGroceryList(list.id)
      setList(fresh)
      onListChanged?.(fresh)
    } catch (err) {
      setError(err.message)
    }
  }

  async function togglePurchased(listItem) {
    const next = listItem.status === 'purchased' ? 'needed' : 'purchased'
    // Optimistic
    setList(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === listItem.id ? { ...i, status: next } : i),
    }))
    try {
      await updateGroceryListItem(list.id, listItem.item_id, { status: next })
    } catch (err) {
      setError(err.message)
      reload()
    }
  }

  async function removeItem(listItem) {
    // Optimistic
    setList(prev => ({ ...prev, items: prev.items.filter(i => i.id !== listItem.id) }))
    try {
      await removeGroceryListItem(list.id, listItem.item_id)
    } catch (err) {
      setError(err.message)
      reload()
    }
  }

  async function handleAdd() {
    if (!addForm.item_id) return
    setAdding(true)
    try {
      await addGroceryListItem(list.id, {
        item_id:  parseInt(addForm.item_id, 10),
        quantity: addForm.quantity || '1',
        unit:     addForm.unit,
        price:    addForm.price || null,
      })
      setAddForm(EMPTY_ADD)
      setPanelOpen(false)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleAdvance() {
    const next = NEXT_STATUS[list.status]
    if (!next) return
    setAdvancing(true)
    try {
      const payload = { status: next }
      if (next === 'completed') payload.shopping_date = new Date().toISOString().slice(0, 10)
      const updated = await updateGroceryList(list.id, payload)
      setList(prev => ({ ...prev, ...updated }))
      onListChanged?.({ ...list, ...updated })
    } catch (err) {
      setError(err.message)
    } finally {
      setAdvancing(false)
    }
  }

  function setAdd(field, value) { setAddForm(p => ({ ...p, [field]: value })) }

  function handleItemSelected(id, defaultUnit) {
    setAdd('item_id', id)
    if (defaultUnit) setAdd('unit', defaultUnit)
  }

  const { total, done } = listSummary(list.items)
  const needed    = list.items.filter(i => i.status === 'needed').sort((a, b) => a.item.name.localeCompare(b.item.name))
  const purchased = list.items.filter(i => i.status === 'purchased').sort((a, b) => a.item.name.localeCompare(b.item.name))
  const nextStatus = NEXT_STATUS[list.status]

  const totalCost = list.items.reduce((sum, i) => {
    return i.price != null ? sum + parseFloat(i.price) * parseFloat(i.quantity) : sum
  }, 0)

  return (
    <div>
      {/* Back bar */}
      <div className="flex items-center gap-3 mb-5 print:hidden">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        >
          ← Back to Lists
        </button>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{list.name}</h2>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${LIST_STATUS_CLS[list.status]}`}>
              {LIST_STATUS_LABEL[list.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {list.store?.name && <span className="mr-3">🏪 {list.store.name}</span>}
            {list.shopping_date && <span className="mr-3">📅 {list.shopping_date}</span>}
            <span>{done}/{total} items purchased</span>
            {totalCost > 0 && <span className="ml-3">· ${totalCost.toFixed(2)} total</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {nextStatus && (
            <button
              onClick={handleAdvance}
              disabled={advancing}
              className="px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-all"
            >
              {advancing ? '…' : NEXT_STATUS_LABEL[list.status]}
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium
              bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300
              hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            🖨 Print
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 rounded-xl
          bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60
          text-red-700 dark:text-red-400 text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="flex-shrink-0 text-lg leading-none">✕</button>
        </div>
      )}

      {/* Items table */}
      <div className="card mb-4">
        {list.items.length === 0 ? (
          <p className="text-center text-slate-400 dark:text-slate-500 text-sm py-8 italic">
            No items yet — add one below.
          </p>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '2rem' }}></th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Price</th>
                  <th className="print:hidden"></th>
                </tr>
              </thead>
              <tbody>
                {needed.map(li => <ItemRow key={li.id} li={li} listId={list.id} onToggle={togglePurchased} onRemove={removeItem} onUpdated={reload} />)}
                {purchased.length > 0 && needed.length > 0 && (
                  <tr>
                    <td colSpan={6} className="py-1 px-3">
                      <div className="h-px bg-slate-200 dark:bg-slate-700" />
                    </td>
                  </tr>
                )}
                {purchased.map(li => <ItemRow key={li.id} li={li} listId={list.id} onToggle={togglePurchased} onRemove={removeItem} onUpdated={reload} purchased />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add item panel */}
      {list.status !== 'completed' && (
        <AddItemPanel
          open={panelOpen}
          onClose={() => { setPanelOpen(false); setAddForm(EMPTY_ADD) }}
          addForm={addForm}
          setAdd={setAdd}
          handleItemSelected={handleItemSelected}
          handleAdd={handleAdd}
          adding={adding}
          catalogItems={catalogItems}
        />
      )}

      {/* FAB — add item */}
      {list.status !== 'completed' && (
        <button
          onClick={() => setPanelOpen(true)}
          title="Add item"
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
            text-2xl leading-none select-none print:hidden"
        >
          +
        </button>
      )}
    </div>
  )
}

const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5'

function AddItemPanel({ open, onClose, addForm, setAdd, handleItemSelected, handleAdd, adding, catalogItems }) {
  const firstRef = useRef(null)

  useEffect(() => {
    if (open) setTimeout(() => firstRef.current?.focus(), 50)
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
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Add Item</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {catalogItems.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 italic">
              No catalog items yet. Go to the On Hand tab to add items first.
            </p>
          ) : (
            <>
              <div>
                <label className={labelCls}>Item <span className="text-red-500 normal-case tracking-normal">*</span></label>
                <ItemCombobox
                  ref={firstRef}
                  value={addForm.item_id}
                  onChange={handleItemSelected}
                  catalogItems={catalogItems}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={addForm.quantity}
                    onChange={e => setAdd('quantity', e.target.value)}
                    placeholder="1"
                    className={`${fieldCls} w-full`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <select
                    value={addForm.unit}
                    onChange={e => setAdd('unit', e.target.value)}
                    className={`${fieldCls} w-full`}
                  >
                    {GROCERY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Price ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addForm.price}
                  onChange={e => setAdd('price', e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  placeholder="Optional"
                  className={`${fieldCls} w-full`}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <button
            onClick={handleAdd}
            disabled={adding || !addForm.item_id}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold
              bg-blue-600 hover:bg-blue-500 text-white
              disabled:opacity-50 disabled:cursor-not-allowed
              shadow-sm shadow-blue-500/25
              transition-all active:scale-[0.98]"
          >
            {adding ? 'Adding…' : 'Add Item'}
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

function ItemRow({ li, listId, onToggle, onRemove, onUpdated, purchased = false }) {
  const [editing, setEditing]   = useState(false)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)

  function startEdit(e) {
    e.stopPropagation()
    setForm({
      quantity: String(parseFloat(li.quantity)),
      unit:     li.unit,
      price:    li.price != null ? String(parseFloat(li.price)) : '',
    })
    setEditing(true)
  }

  async function saveEdit() {
    setSaving(true)
    try {
      await updateGroceryListItem(listId, li.item_id, {
        quantity: form.quantity || '1',
        unit:     form.unit,
        price:    form.price !== '' ? form.price : null,
      })
      await onUpdated()
      setEditing(false)
    } catch (err) {
      // bubble up — parent shows error banner
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() { setEditing(false) }

  function set(field, value) { setForm(p => ({ ...p, [field]: value })) }

  const inputCls = 'px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500'

  if (editing) {
    return (
      <tr>
        <td>
          <input
            type="checkbox"
            checked={purchased}
            onChange={() => onToggle(li)}
            className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
          />
        </td>
        <td className="font-medium text-slate-800 dark:text-slate-100">{li.item.name}</td>
        <td>
          <input
            autoFocus
            type="number"
            min="0"
            step="0.001"
            value={form.quantity}
            onChange={e => set('quantity', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
            className={`${inputCls} w-20`}
          />
        </td>
        <td>
          <select
            value={form.unit}
            onChange={e => set('unit', e.target.value)}
            className={`${inputCls} w-24`}
          >
            {GROCERY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </td>
        <td>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={e => set('price', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
            placeholder="—"
            className={`${inputCls} w-24`}
          />
        </td>
        <td className="print:hidden">
          <div className="flex items-center gap-1">
            <button onClick={saveEdit} disabled={saving} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-50 transition-colors">
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={cancelEdit} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
              Cancel
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className={`group ${purchased ? 'opacity-50' : ''}`}>
      <td>
        <input
          type="checkbox"
          checked={purchased}
          onChange={() => onToggle(li)}
          className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
        />
      </td>
      <td className={`font-medium ${purchased ? 'line-through text-slate-400 dark:text-slate-500' : ''}`}>
        {li.item.name}
      </td>
      <td
        onClick={startEdit}
        title="Click to edit"
        className="editable-cell text-slate-500 dark:text-slate-400 text-sm whitespace-nowrap cursor-pointer"
      >
        {parseFloat(li.quantity) % 1 === 0 ? parseFloat(li.quantity) : parseFloat(li.quantity)}
      </td>
      <td
        onClick={startEdit}
        title="Click to edit"
        className="editable-cell text-slate-500 dark:text-slate-400 text-sm cursor-pointer"
      >
        {li.unit}
      </td>
      <td
        onClick={startEdit}
        title="Click to edit"
        className="editable-cell text-slate-500 dark:text-slate-400 text-sm whitespace-nowrap cursor-pointer"
      >
        {fmtPrice(li.price)}
      </td>
      <td className="print:hidden">
        <button
          onClick={() => onRemove(li)}
          title="Remove from list"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-sm opacity-0 group-hover:opacity-100 transition-opacity"
        >✕</button>
      </td>
    </tr>
  )
}
