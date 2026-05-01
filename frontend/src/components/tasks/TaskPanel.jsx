import React, { useState, useEffect, useRef, useCallback } from 'react'
import { STATUS_OPTIONS, STATUS_LABELS, localDate } from './helpers'

const RECURRENCE_OPTIONS = [
  { value: 'none',       label: 'One-time' },
  { value: 'daily',      label: 'Daily' },
  { value: 'weekly',     label: 'Weekly' },
  { value: 'biweekly',   label: 'Biweekly' },
  { value: 'monthly',    label: 'Monthly' },
  { value: 'quarterly',  label: 'Every 3 Months' },
  { value: 'semiannual', label: 'Every 6 Months' },
  { value: 'yearly',     label: 'Yearly' },
]

const PRIORITY_OPTIONS = ['low', 'medium', 'high']

const PRIORITY_BTN = {
  low:    { active: 'bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200', dot: 'bg-slate-400' },
  medium: { active: 'bg-amber-100 text-amber-700 dark:bg-amber-500/25 dark:text-amber-300', dot: 'bg-amber-500' },
  high:   { active: 'bg-red-100 text-red-700 dark:bg-red-500/25 dark:text-red-300', dot: 'bg-red-500' },
}

const fieldCls = `w-full px-3 py-2 text-sm rounded-lg
  bg-white dark:bg-slate-800
  border border-slate-200 dark:border-slate-700
  text-slate-800 dark:text-slate-200
  placeholder-slate-400 dark:placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-blue-500/50
  transition-shadow`

const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5'

// Category combobox using a <datalist>
function CategoryCombobox({ value, onChange, categories }) {
  const id = React.useId()
  const toText = useCallback(v => {
    const c = categories.find(c => String(c.id) === String(v))
    return c ? `${c.icon} ${c.name}` : ''
  }, [categories])
  const [text, setText] = useState(() => toText(value))

  useEffect(() => { setText(toText(value)) }, [value, toText])

  function handleChange(e) {
    const t = e.target.value
    setText(t)
    const match = categories.find(c => `${c.icon} ${c.name}` === t || c.name === t)
    if (match) onChange(String(match.id))
    else if (!t) onChange('')
  }

  return (
    <>
      <input
        list={id}
        value={text}
        onChange={handleChange}
        onBlur={() => setText(toText(value))}
        className={fieldCls}
        placeholder="None"
        autoComplete="off"
      />
      <datalist id={id}>
        {categories.map(c => <option key={c.id} value={`${c.icon} ${c.name}`} />)}
      </datalist>
    </>
  )
}

// Subtask row inside the panel edit form
function SubtaskRow({ sub, taskId, onPatch, onDelete, onStartEdit, isEditing, editForm, onEditFormChange, onSaveEdit, onCancelEdit }) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-2 flex-wrap p-2 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-blue-500/30">
        <input
          autoFocus
          value={editForm.title}
          onChange={e => onEditFormChange('title', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit() }}
          className={`${fieldCls} flex-1 min-w-[140px]`}
        />
        <input
          type="date"
          value={editForm.due_date}
          onChange={e => onEditFormChange('due_date', e.target.value)}
          className={fieldCls}
          style={{ width: 'auto' }}
        />
        <button onClick={onSaveEdit} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors">Save</button>
        <button onClick={onCancelEdit} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Cancel</button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 group/sub transition-colors">
      <input
        type="checkbox"
        checked={sub.status === 'done'}
        onChange={e => onPatch(taskId, sub.id, { status: e.target.checked ? 'done' : 'todo' })}
        className="w-4 h-4 rounded accent-emerald-500 cursor-pointer flex-shrink-0"
      />
      <span
        className={`flex-1 text-sm leading-snug
          ${sub.status === 'done' ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-300'}`}
      >
        {sub.title}
      </span>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => onStartEdit(sub)}
          aria-label={`Edit subtask: ${sub.title}`}
          title="Edit subtask"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors text-sm"
        >✎</button>
        <button
          onClick={() => onDelete(taskId, sub.id)}
          aria-label={`Delete subtask: ${sub.title}`}
          title="Delete subtask"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-sm"
        >✕</button>
      </div>
    </div>
  )
}

export default function TaskPanel({
  open,
  mode,
  task,
  onClose,
  onCreateTask,
  onUpdateTask,
  persons,
  categories,
  onPatchSubtask,
  onAddSubtask,
  onDeleteSubtask,
}) {
  const isCreate = mode === 'create'
  const [form, setForm] = useState({})
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [editingSubtask, setEditingSubtask] = useState(null) // subtask id
  const [editSubForm, setEditSubForm] = useState({})
  const [saving, setSaving] = useState(false)
  const titleRef = useRef(null)

  // Sync form whenever the panel opens or the task changes
  useEffect(() => {
    if (!open) return
    if (isCreate) {
      setForm({
        title: '', description: '', priority: 'medium', status: 'todo',
        due_date: localDate(), estimated_minutes: '',
        assignee_id: '', category_id: '', recurrence: 'none',
      })
    } else if (task) {
      setForm({
        title: task.title ?? '',
        description: task.description ?? '',
        priority: task.priority ?? 'medium',
        status: task.status ?? 'todo',
        due_date: task.due_date ?? '',
        estimated_minutes: task.estimated_minutes ?? '',
        assignee_id: task.assignee_id ?? '',
        category_id: task.category_id ?? '',
        recurrence: task.recurrence ?? 'none',
      })
    }
    setNewSubtaskTitle('')
    setEditingSubtask(null)
  }, [open, task, isCreate])

  // Autofocus the title when panel opens
  useEffect(() => {
    if (open) setTimeout(() => titleRef.current?.focus(), 50)
  }, [open])

  // Close on Escape
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
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
      status: form.status,
      due_date: form.due_date || null,
      estimated_minutes: form.estimated_minutes ? parseInt(form.estimated_minutes, 10) : null,
      assignee_id: form.assignee_id ? parseInt(form.assignee_id, 10) : null,
      category_id: form.category_id ? parseInt(form.category_id, 10) : null,
      recurrence: form.recurrence,
    }
    try {
      if (isCreate) {
        await onCreateTask(payload)
      } else {
        await onUpdateTask(task.id, payload)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleAddSubtask() {
    const title = newSubtaskTitle.trim()
    if (!title || !task?.id) return
    await onAddSubtask(task.id, title)
    setNewSubtaskTitle('')
  }

  function startEditSubtask(sub) {
    setEditingSubtask(sub.id)
    setEditSubForm({ title: sub.title, due_date: sub.due_date ?? '' })
  }

  async function saveEditSubtask() {
    if (!editingSubtask || !task?.id) return
    await onPatchSubtask(task.id, editingSubtask, {
      title: editSubForm.title.trim(),
      due_date: editSubForm.due_date || null,
    })
    setEditingSubtask(null)
  }

  const sortedSubtasks = task?.subtasks
    ? [...task.subtasks].sort((a, b) => a.order - b.order)
    : []

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 dark:bg-black/60 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[480px] max-w-full z-50
          bg-white dark:bg-slate-900
          border-l border-slate-200 dark:border-slate-700/60
          shadow-2xl
          flex flex-col
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
        onKeyDown={e => {
          if (isCreate && e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
            handleSave()
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {isCreate ? 'New Task' : 'Edit Task'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Title */}
          <div>
            <label className={labelCls}>Title <span className="text-red-500 normal-case tracking-normal">*</span></label>
            <input
              ref={titleRef}
              value={form.title ?? ''}
              onChange={e => set('title', e.target.value)}
              placeholder="Task title"
              className={fieldCls}
            />
          </div>

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

          {/* Priority — segmented buttons */}
          <div>
            <label className={labelCls}>Priority</label>
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => set('priority', p)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all
                    ${form.priority === p
                      ? PRIORITY_BTN[p].active
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                >
                  <span className={`w-2 h-2 rounded-full ${PRIORITY_BTN[p].dot}`} />
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <label className={labelCls}>Status</label>
            <select value={form.status ?? 'todo'} onChange={e => set('status', e.target.value)} className={fieldCls}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>

          {/* Due date + Est. minutes — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Due Date</label>
              <input
                type="date"
                value={form.due_date ?? ''}
                onChange={e => set('due_date', e.target.value)}
                className={fieldCls}
              />
            </div>
            <div>
              <label className={labelCls}>Est. Minutes</label>
              <input
                type="number"
                min="1"
                value={form.estimated_minutes ?? ''}
                onChange={e => set('estimated_minutes', e.target.value)}
                placeholder="—"
                className={fieldCls}
              />
            </div>
          </div>

          {/* Assignee + Recurrence — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Assignee</label>
              <select value={form.assignee_id ?? ''} onChange={e => set('assignee_id', e.target.value)} className={fieldCls}>
                <option value="">Unassigned</option>
                {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Recurrence</label>
              <select value={form.recurrence ?? 'none'} onChange={e => set('recurrence', e.target.value)} className={fieldCls}>
                {RECURRENCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className={labelCls}>Category</label>
            <CategoryCombobox
              value={form.category_id ?? ''}
              onChange={id => set('category_id', id)}
              categories={categories}
            />
          </div>

          {/* Subtasks section — edit mode only */}
          {!isCreate && task && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                Subtasks
                {sortedSubtasks.length > 0 && (
                  <span className="ml-2 text-slate-400 dark:text-slate-500 normal-case tracking-normal">
                    {sortedSubtasks.filter(s => s.status === 'done').length}/{sortedSubtasks.length} done
                  </span>
                )}
              </p>

              {sortedSubtasks.length > 0 && (
                <div className="space-y-0.5 mb-3">
                  {sortedSubtasks.map(sub => (
                    <SubtaskRow
                      key={sub.id}
                      sub={sub}
                      taskId={task.id}
                      onPatch={onPatchSubtask}
                      onDelete={onDeleteSubtask}
                      onStartEdit={startEditSubtask}
                      isEditing={editingSubtask === sub.id}
                      editForm={editSubForm}
                      onEditFormChange={(field, val) => setEditSubForm(p => ({ ...p, [field]: val }))}
                      onSaveEdit={saveEditSubtask}
                      onCancelEdit={() => setEditingSubtask(null)}
                    />
                  ))}
                </div>
              )}

              {/* Add subtask */}
              <div className="flex gap-2">
                <input
                  placeholder="Add subtask…"
                  value={newSubtaskTitle}
                  onChange={e => setNewSubtaskTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddSubtask()}
                  className={`${fieldCls} flex-1`}
                />
                <button
                  onClick={handleAddSubtask}
                  disabled={!newSubtaskTitle.trim()}
                  className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Add
                </button>
              </div>
            </div>
          )}
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
            {saving ? 'Saving…' : isCreate ? 'Create Task' : 'Save Changes'}
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
