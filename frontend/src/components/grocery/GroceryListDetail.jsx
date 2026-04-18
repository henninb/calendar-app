import React, { useState, useId, useCallback } from 'react'
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

function ItemCombobox({ value, onChange, catalogItems }) {
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
}

export default function GroceryListDetail({ list: initialList, catalogItems, onBack, onListChanged }) {
  const [list, setList]     = useState(initialList)
  const [addForm, setAddForm] = useState(EMPTY_ADD)
  const [adding, setAdding]   = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [error, setError]     = useState(null)

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

      {/* Add item form */}
      {list.status !== 'completed' && (
        <div className="card print:hidden">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
            Add Item
          </p>
          {catalogItems.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 italic">
              No catalog items yet. Go to the On Hand tab to add items first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[160px]">
                <ItemCombobox
                  value={addForm.item_id}
                  onChange={handleItemSelected}
                  catalogItems={catalogItems}
                />
              </div>
              <input
                type="number"
                min="0"
                step="0.001"
                value={addForm.quantity}
                onChange={e => setAdd('quantity', e.target.value)}
                placeholder="Qty"
                className={`${fieldCls} w-20`}
              />
              <select
                value={addForm.unit}
                onChange={e => setAdd('unit', e.target.value)}
                className={`${fieldCls} w-24`}
              >
                {GROCERY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={addForm.price}
                onChange={e => setAdd('price', e.target.value)}
                placeholder="Price $"
                className={`${fieldCls} w-24`}
              />
              <button
                onClick={handleAdd}
                disabled={adding || !addForm.item_id}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {adding ? '…' : 'Add'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
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
