import React, {
  useState, useEffect, useCallback, useMemo, useRef, useReducer,
} from 'react'
import {
  fetchTasks, fetchPersons, fetchCategories, createTask, updateTask, deleteTask,
  createSubtask, updateSubtask, deleteSubtask,
} from '../api'

// ── Module-level constants ─────────────────────────────────────────────────
const STATUS_OPTIONS  = ['todo', 'in_progress', 'done', 'cancelled']
const STATUS_LABELS   = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled' }
const PRIORITY_COLORS = { low: '#64748b', medium: '#d97706', high: '#dc2626' }
const STATUS_BG       = { todo: '#dbeafe', in_progress: '#fef3c7', done: '#dcfce7', cancelled: '#f1f5f9' }
const STATUS_FG       = { todo: '#1d4ed8', in_progress: '#92400e', done: '#15803d', cancelled: '#64748b' }
const TASK_FETCH_LIMIT = 500

// #12: stable style objects outside the component — no per-render allocation
const inputStyle = {
  border: '1px solid #cbd5e1', borderRadius: '6px', padding: '.35rem .65rem',
  fontSize: '.875rem', background: '#fff', color: '#1e293b',
}
const labelStyle = { fontSize: '.8rem', color: '#475569', display: 'block', marginBottom: '.2rem' }

// ── Pure helpers ───────────────────────────────────────────────────────────

// #21: safe hex-alpha helper — handles #rrggbb and #rgb; falls back for other formats
function withAlpha(hex, alpha) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex + a
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const [, r, g, b] = hex
    return `#${r.repeat(2)}${g.repeat(2)}${b.repeat(2)}${a}`
  }
  return hex // named colors, rgb(), etc.
}

// #22: extracted from inline JSX so it's readable and reusable
function isOverdue(task) {
  return (
    task.due_date &&
    new Date(task.due_date + 'T00:00:00') < new Date() &&
    task.status !== 'done' &&
    task.status !== 'cancelled'
  )
}

function fmt(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function daysBadge(dateStr) {
  if (!dateStr) return null
  const diff = Math.ceil((new Date(dateStr + 'T00:00:00') - new Date()) / 86400000)
  const color = diff < 0 ? '#dc2626' : diff <= 3 ? '#d97706' : '#64748b'
  const label = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'today' : `${diff}d`
  return <span style={{ fontSize: '.75rem', color, fontWeight: 600, marginLeft: '.4rem' }}>{label}</span>
}

function localDate(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const emptyTask = () => ({
  title: '', priority: 'medium', due_date: localDate(), estimated_minutes: '',
  assignee_id: '', category_id: '', recurrence: 'none',
})

// ── CategoryCombobox ───────────────────────────────────────────────────────
function CategoryCombobox({ value, onChange, categories, style }) {
  const id = React.useId()
  const toText = v => {
    const c = categories.find(c => String(c.id) === String(v))
    return c ? `${c.icon} ${c.name}` : ''
  }
  const [text, setText] = React.useState(() => toText(value))

  React.useEffect(() => { setText(toText(value)) }, [value, categories])

  function handleChange(e) {
    const t = e.target.value
    setText(t)
    const match = categories.find(c => `${c.icon} ${c.name}` === t || c.name === t)
    if (match) onChange(String(match.id))
    else if (!t) onChange('')
  }

  function handleBlur() {
    setText(toText(value))
  }

  return (
    <>
      <input list={id} value={text} onChange={handleChange} onBlur={handleBlur}
        style={style} placeholder="None" autoComplete="off" />
      <datalist id={id}>
        {categories.map(c => <option key={c.id} value={`${c.icon} ${c.name}`} />)}
      </datalist>
    </>
  )
}

// ── NewTaskForm ────────────────────────────────────────────────────────────
// #14: extracted sub-component so typing in the form doesn't re-render the task table
const NewTaskForm = React.memo(function NewTaskForm({
  newTask, onChange, onSubmit, onCancel, persons, categories,
}) {
  return (
    <div style={{
      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
      padding: '1rem', marginBottom: '1rem', display: 'flex', gap: '.75rem',
      flexWrap: 'wrap', alignItems: 'flex-end',
    }}>
      <div style={{ flex: '2 1 220px' }}>
        <label style={labelStyle}>Title *</label>
        <input
          autoFocus
          value={newTask.title}
          onChange={e => onChange('title', e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSubmit()}
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
          placeholder="Task title"
        />
      </div>
      <div>
        <label style={labelStyle}>Recurrence</label>
        <select value={newTask.recurrence} onChange={e => onChange('recurrence', e.target.value)} style={inputStyle}>
          <option value="none">One-time</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Biweekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Every 3 Months</option>
          <option value="semiannual">Every 6 Months</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>Priority</label>
        <select value={newTask.priority} onChange={e => onChange('priority', e.target.value)} style={inputStyle}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div>
        <label style={labelStyle}>Due date</label>
        <input type="date" value={newTask.due_date} onChange={e => onChange('due_date', e.target.value)} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Est. minutes</label>
        <input
          type="number" min="1" value={newTask.estimated_minutes}
          onChange={e => onChange('estimated_minutes', e.target.value)}
          style={{ ...inputStyle, width: '90px' }}
        />
      </div>
      <div>
        <label style={labelStyle}>Assignee</label>
        <select value={newTask.assignee_id} onChange={e => onChange('assignee_id', e.target.value)} style={inputStyle}>
          <option value="">Unassigned</option>
          {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Category</label>
        <CategoryCombobox value={newTask.category_id} onChange={id => onChange('category_id', id)}
          categories={categories} style={inputStyle} />
      </div>
      <div style={{ display: 'flex', gap: '.5rem' }}>
        <button onClick={onSubmit} className="btn btn-green" title="Save and create this task">Add</button>
        <button onClick={onCancel} className="btn btn-gray" title="Discard and close the new task form">Cancel</button>
      </div>
    </div>
  )
})

// ── TaskRow ────────────────────────────────────────────────────────────────
// #14: extracted sub-component with React.memo.
// All callback props are stable references from the parent (useCallback / ref-trick),
// so a row only re-renders when its own data changes.
//
// Prop contract:
//   onToggleExpand(taskId), onStartEdit(task), onSaveEdit(taskId) — stable
//   onPatchTask(taskId, data), onDeleteTask(taskId)               — stable
//   onAddSubtask(taskId), onNewSubtaskChange(taskId, title)       — stable
//   onPatchSubtask(taskId, subtaskId, data)                       — stable
//   onDeleteSubtask(taskId, subtaskId)                            — stable
//   onStartEditSubtask(taskId, sub), onSaveEditSubtask()          — stable
//   editForm / editSubForm  — only passed when isEditing / editingSubtaskId is set
const TaskRow = React.memo(function TaskRow({
  task,
  expanded,
  onToggleExpand,
  isEditing,
  editForm,
  onEditFormChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  editingSubtaskId,
  editSubForm,
  onEditSubFormChange,
  onStartEditSubtask,
  onSaveEditSubtask,
  onCancelEditSubtask,
  newSubtaskTitle,
  onNewSubtaskChange,
  onAddSubtask,
  onPatchTask,
  onDeleteTask,
  onPatchSubtask,
  onDeleteSubtask,
  persons,
  categories,
  showCompleted,
}) {
  const [editingField, setEditingField] = useState(null)

  // Create task-scoped stable handlers so inline JSX below doesn't create new
  // function references on every render of THIS row.
  const handleToggleExpand = useCallback(() => onToggleExpand(task.id),          [onToggleExpand, task.id])
  const handleStartEdit    = useCallback(() => onStartEdit(task),                 [onStartEdit, task])
  const handleSaveEdit     = useCallback(() => onSaveEdit(task.id),               [onSaveEdit, task.id])
  const handleAddSubtask   = useCallback(() => onAddSubtask(task.id),             [onAddSubtask, task.id])
  const handleSubChange    = useCallback(e  => onNewSubtaskChange(task.id, e.target.value), [onNewSubtaskChange, task.id])

  return (
    <React.Fragment>
      <tr style={isOverdue(task) ? { background: '#fee2e2' } : {}}>
        <td style={{ whiteSpace: 'nowrap' }}>
          <span style={{
            display: 'inline-block', padding: '.2rem .55rem', borderRadius: '4px',
            fontSize: '.78rem', fontWeight: 700,
            background: STATUS_BG[task.status], color: STATUS_FG[task.status],
          }}>
            {STATUS_LABELS[task.status]}
          </span>
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button
            onClick={handleToggleExpand}
            title={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
            style={{
              background: 'none', border: 'none', color: '#1e293b', cursor: 'pointer',
              padding: 0, textAlign: 'left', fontSize: '.875rem', fontWeight: 500, whiteSpace: 'nowrap',
            }}
          >
            {expanded ? '▾' : '▸'} {task.title}
          </button>
          {task.category && (
            <span style={{
              fontSize: '.72rem', marginLeft: '.5rem', fontWeight: 600,
              background: withAlpha(task.category.color, 0.13),
              color: task.category.color,
              border: `1px solid ${withAlpha(task.category.color, 0.33)}`,
              borderRadius: '4px', padding: '.1rem .35rem',
            }}>
              {task.category.icon} {task.category.name}
            </span>
          )}
          {task.recurrence && task.recurrence !== 'none' && (
            <span style={{ fontSize: '.72rem', color: '#2563eb', marginLeft: '.5rem', fontWeight: 600 }}>
              ↻ {task.recurrence}
            </span>
          )}
          {task.subtasks?.length > 0 && (
            <span style={{ fontSize: '.75rem', color: '#64748b', marginLeft: '.4rem' }}>
              {task.subtasks.filter(s => s.status === 'done').length}/{task.subtasks.length}
            </span>
          )}
        </td>
        <td style={{ color: PRIORITY_COLORS[task.priority], fontWeight: 600, textTransform: 'capitalize', fontSize: '.875rem' }}>
          {editingField === 'priority' ? (
            <select
              autoFocus
              defaultValue={task.priority}
              onChange={e => {
                onPatchTask(task.id, { priority: e.target.value })
                setEditingField(null)
              }}
              onBlur={() => setEditingField(null)}
              onKeyDown={e => e.key === 'Escape' && setEditingField(null)}
              style={{ fontSize: '.875rem' }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          ) : (
            <span
              onClick={() => setEditingField('priority')}
              title="Click to edit priority"
              style={{ cursor: 'pointer', borderBottom: '1px dashed #94a3b8' }}
            >
              {task.priority}
            </span>
          )}
        </td>
        <td style={{ whiteSpace: 'nowrap', fontSize: '.875rem' }}>
          {editingField === 'due_date' ? (
            <input
              autoFocus
              type="date"
              defaultValue={task.due_date ?? ''}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  onPatchTask(task.id, { due_date: e.target.value || null })
                  setEditingField(null)
                } else if (e.key === 'Escape') {
                  setEditingField(null)
                }
              }}
              onBlur={e => {
                onPatchTask(task.id, { due_date: e.target.value || null })
                setEditingField(null)
              }}
              style={{ fontSize: '.875rem' }}
            />
          ) : (
            <span
              onClick={() => setEditingField('due_date')}
              title="Click to edit due date"
              style={{ cursor: 'pointer', borderBottom: '1px dashed #94a3b8' }}
            >
              {fmt(task.due_date)}{task.status !== 'done' && task.status !== 'cancelled' && daysBadge(task.due_date)}
            </span>
          )}
        </td>
        {showCompleted && (
          <td style={{ whiteSpace: 'nowrap', fontSize: '.875rem', color: '#15803d' }}>
            {task.completed_at ? new Date(task.completed_at).toLocaleString() : '—'}
          </td>
        )}
        <td style={{ color: '#64748b', fontSize: '.875rem' }}>
          {editingField === 'estimated_minutes' ? (
            <input
              autoFocus
              type="number"
              min="1"
              defaultValue={task.estimated_minutes ?? ''}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = parseInt(e.target.value, 10)
                  onPatchTask(task.id, { estimated_minutes: val > 0 ? val : null })
                  setEditingField(null)
                } else if (e.key === 'Escape') {
                  setEditingField(null)
                }
              }}
              onBlur={e => {
                const val = parseInt(e.target.value, 10)
                onPatchTask(task.id, { estimated_minutes: val > 0 ? val : null })
                setEditingField(null)
              }}
              style={{ width: '70px', fontSize: '.875rem' }}
            />
          ) : (
            <span
              onClick={() => setEditingField('estimated_minutes')}
              title="Click to edit estimated minutes"
              style={{ cursor: 'pointer', borderBottom: '1px dashed #94a3b8' }}
            >
              {task.estimated_minutes ? `${task.estimated_minutes}m` : '—'}
            </span>
          )}
        </td>
        <td style={{ color: '#475569', fontSize: '.875rem' }}>
          {editingField === 'assignee_id' ? (
            <select
              autoFocus
              defaultValue={task.assignee_id ?? ''}
              onChange={e => {
                onPatchTask(task.id, { assignee_id: e.target.value || null })
                setEditingField(null)
              }}
              onBlur={() => setEditingField(null)}
              style={{ fontSize: '.875rem' }}
            >
              <option value="">Unassigned</option>
              {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <span
              onClick={() => setEditingField('assignee_id')}
              title="Click to edit assignee"
              style={{ cursor: 'pointer', borderBottom: '1px dashed #94a3b8' }}
            >
              {task.assignee?.name ?? '—'}
            </span>
          )}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'nowrap' }}>
            {task.status !== 'done' && (
              <button className="btn btn-green" title="Mark this task as done"
                onClick={() => onPatchTask(task.id, { status: 'done' })}>✓ Done</button>
            )}
            {task.status === 'todo' && (
              <button className="btn" title="Mark this task as in progress"
                style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #d97706' }}
                onClick={() => onPatchTask(task.id, { status: 'in_progress' })}>Start</button>
            )}
            {task.status !== 'cancelled' && task.status !== 'done' && (
              <button className="btn btn-gray" title="Cancel this task"
                onClick={() => onPatchTask(task.id, { status: 'cancelled' })} style={{ padding: '0 .45rem' }}>⊘</button>
            )}
            <button className="btn btn-blue" title="Edit this task's details" onClick={handleStartEdit} style={{ padding: '0 .45rem' }}>✎</button>
            <button className="btn btn-red" title="Permanently delete this task"
              onClick={() => onDeleteTask(task.id)} style={{ padding: '0 .45rem' }}>✕</button>
          </div>
        </td>
      </tr>

      {/* Inline edit form */}
      {isEditing && (
        <tr>
          <td colSpan={showCompleted ? 7 : 6} style={{ background: '#f8fafc', padding: '1rem 1rem 1rem 2.5rem', borderBottom: '2px solid #3b82f6' }}
            onKeyDown={e => e.key === 'Escape' && onCancelEdit()}>
            {/* Row 1: Title + Description */}
            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', marginBottom: '.5rem' }}>
              <div style={{ flex: '2 1 0' }}>
                <label style={labelStyle}>Title *</label>
                <input
                  autoFocus
                  value={editForm.title}
                  onChange={e => onEditFormChange('title', e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: '2 1 0' }}>
                <label style={labelStyle}>Description</label>
                <input
                  value={editForm.description}
                  onChange={e => onEditFormChange('description', e.target.value)}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  placeholder="Optional"
                />
              </div>
            </div>
            {/* Row 2: short fields + buttons */}
            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={labelStyle}>Status</label>
                <select value={editForm.status} onChange={e => onEditFormChange('status', e.target.value)} style={inputStyle}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Recurrence</label>
                <select value={editForm.recurrence} onChange={e => onEditFormChange('recurrence', e.target.value)} style={inputStyle}>
                  <option value="none">One-time</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Every 3 Months</option>
                  <option value="semiannual">Every 6 Months</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <select value={editForm.priority} onChange={e => onEditFormChange('priority', e.target.value)} style={inputStyle}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Due date</label>
                <input type="date" value={editForm.due_date} onChange={e => onEditFormChange('due_date', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Est. minutes</label>
                <input type="number" min="1" value={editForm.estimated_minutes}
                  onChange={e => onEditFormChange('estimated_minutes', e.target.value)}
                  style={{ ...inputStyle, width: '90px' }} />
              </div>
              <div>
                <label style={labelStyle}>Assignee</label>
                <select value={editForm.assignee_id} onChange={e => onEditFormChange('assignee_id', e.target.value)} style={inputStyle}>
                  <option value="">Unassigned</option>
                  {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Category</label>
                <CategoryCombobox value={editForm.category_id} onChange={id => onEditFormChange('category_id', id)}
                  categories={categories} style={inputStyle} />
              </div>
            </div>
          </td>
          <td style={{ background: '#f8fafc', borderBottom: '2px solid #3b82f6', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button onClick={handleSaveEdit} className="btn btn-green" title="Save changes to this task">Save</button>
              <button onClick={onCancelEdit} className="btn btn-gray" title="Discard changes and close the edit form">Cancel</button>
            </div>
          </td>
        </tr>
      )}

      {/* Expanded subtasks */}
      {expanded && (
        <tr>
          <td colSpan={showCompleted ? 7 : 6} style={{ background: '#f8fafc', paddingLeft: '2.5rem', paddingBottom: '.75rem' }}>
            {task.description && (
              <p style={{ color: '#475569', fontSize: '.85rem', margin: '.4rem 0 .75rem' }}>{task.description}</p>
            )}
            <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.5rem' }}>
              Subtasks
            </div>
            {(task.subtasks || []).sort((a, b) => a.order - b.order).map(sub => (
              <div key={sub.id} className="subtask-row" style={{ marginBottom: '.35rem' }}>
                {editingSubtaskId === sub.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                    <input
                      autoFocus
                      value={editSubForm.title}
                      onChange={e => onEditSubFormChange('title', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && onSaveEditSubtask()}
                      style={{ ...inputStyle, flex: '1 1 160px' }}
                    />
                    <input
                      type="date"
                      value={editSubForm.due_date}
                      onChange={e => onEditSubFormChange('due_date', e.target.value)}
                      style={inputStyle}
                    />
                    <select
                      value={editSubForm.status}
                      onChange={e => onEditSubFormChange('status', e.target.value)}
                      style={{ ...inputStyle, background: STATUS_BG[editSubForm.status], color: STATUS_FG[editSubForm.status], fontWeight: 600 }}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                    <button onClick={onSaveEditSubtask} className="btn btn-green" title="Save subtask">Save</button>
                    <button onClick={onCancelEditSubtask} className="btn btn-gray" title="Cancel edit">Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <input
                      type="checkbox"
                      checked={sub.status === 'done'}
                      onChange={e => onPatchSubtask(task.id, sub.id, { status: e.target.checked ? 'done' : 'todo' })}
                      style={{ cursor: 'pointer', accentColor: '#22c55e', width: '16px', height: '16px' }}
                    />
                    <span style={{
                      color: sub.status === 'done' ? '#94a3b8' : '#1e293b',
                      textDecoration: sub.status === 'done' ? 'line-through' : 'none',
                      flex: 1, fontSize: '.875rem',
                    }}>
                      {sub.title}
                    </span>
                    {sub.due_date && (
                      <span style={{ fontSize: '.78rem', color: '#64748b' }}>{fmt(sub.due_date)}</span>
                    )}
                    <select
                      value={sub.status}
                      onChange={e => onPatchSubtask(task.id, sub.id, { status: e.target.value })}
                      style={{ fontSize: '.78rem', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '.15rem .3rem', background: STATUS_BG[sub.status], color: STATUS_FG[sub.status], fontWeight: 600, cursor: 'pointer' }}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                    {/* #24: aria-label for screen readers */}
                    <button
                      onClick={() => onStartEditSubtask(task.id, sub)}
                      aria-label={`Edit subtask: ${sub.title}`}
                      title="Edit this subtask"
                      style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '.9rem', padding: '0 .2rem' }}
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => onDeleteSubtask(task.id, sub.id)}
                      aria-label={`Delete subtask: ${sub.title}`}
                      title="Delete this subtask"
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '.9rem', padding: '0 .2rem' }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem' }}>
              <input
                placeholder="Add subtask…"
                value={newSubtaskTitle}
                onChange={handleSubChange}
                onKeyDown={e => e.key === 'Enter' && handleAddSubtask()}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={handleAddSubtask} className="btn btn-blue" title="Add this subtask">Add</button>
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
})

// ── TaskList ───────────────────────────────────────────────────────────────
export default function TaskList() {
  const [tasks, setTasks]                   = useState([])
  const [persons, setPersons]               = useState([])
  const [categories, setCategories]         = useState([])
  // #20: consistent, descriptive state setter names
  const [filterStatus, setFilterStatus]     = useState(['todo', 'in_progress'])
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterTomorrow, setFilterTomorrow] = useState(false)
  const [filterToday, setFilterToday]       = useState(false)
  const [expanded, setExpanded]             = useState({})
  const [newSubtask, setNewSubtask]         = useState({})
  const [addingTask, setAddingTask]         = useState(false)
  const [newTask, setNewTask]               = useState(emptyTask)
  const [editingId, setEditingId]           = useState(null)
  const [editForm, setEditForm]             = useState({})
  const [editingSubtask, setEditingSubtask] = useState(null) // { taskId, subtaskId }
  const [editSubForm, setEditSubForm]       = useState({})
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState(null) // #5: surface load/CRUD errors

  // #7, #8: refs so stable callbacks always read the latest state without being recreated
  const newSubtaskRef = useRef(newSubtask)
  newSubtaskRef.current = newSubtask
  const editFormRef = useRef(editForm)
  editFormRef.current = editForm
  const editSubRef = useRef({ editingSubtask, editSubForm })
  editSubRef.current = { editingSubtask, editSubForm }

  // #9: tick every minute so date badges (today / overdue) stay accurate on idle tabs
  const [, tick] = useReducer(x => x + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  // #7: AbortController ref — cancels in-flight load on rapid re-calls or unmount
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    setLoading(true)
    setError(null)
    // #18: log timing for load performance visibility
    const t0 = performance.now()
    try {
      const [t, p, c] = await Promise.all([
        fetchTasks({}, signal),
        fetchPersons(signal),
        fetchCategories(signal),
      ])
      console.debug(`[TaskList] loaded ${t.length} tasks in ${(performance.now() - t0).toFixed(0)}ms`)
      // #15: warn when results are capped by the server-side limit
      if (t.length >= TASK_FETCH_LIMIT) {
        console.warn(`[TaskList] hit fetch limit (${TASK_FETCH_LIMIT}); some tasks may not be shown`)
      }
      setTasks(t)
      setPersons(p)
      setCategories(c)
    } catch (err) {
      if (err.name === 'AbortError') return // intentional abort — not an error
      // #5, #16: log and surface the error
      console.error('[TaskList] load failed:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort() // cancel on unmount
  }, [load])

  const today    = localDate(0)
  const tomorrow = localDate(1)

  // #11: memoised filter + sort — only recomputes when tasks or filter state changes
  const visible = useMemo(() => tasks
    .filter(t => {
      if (filterStatus.length && !filterStatus.includes(t.status)) return false
      if (filterAssignee === 'unassigned') { if (t.assignee_id != null) return false }
      else if (filterAssignee && String(t.assignee_id) !== filterAssignee) return false
      if (filterToday    && t.due_date !== today)    return false
      if (filterTomorrow && t.due_date !== tomorrow) return false
      if (filterCategory && String(t.category_id) !== filterCategory) return false
      return true
    })
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
    }),
  [tasks, filterStatus, filterAssignee, filterCategory, filterToday, filterTomorrow, today, tomorrow])

  // ── Stable event handlers ──────────────────────────────────────────────

  const toggleStatus = useCallback((s) =>
    setFilterStatus(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]),
  [])

  // #6, #8, #16, #17: error handling, server response, logging
  const patchTask = useCallback(async (id, data) => {
    try {
      const updated = await updateTask(id, data)
      if (data.status === 'done') {
        console.info(`[TaskList] task ${id} marked done — reloading for recurrence`)
        await load()
      } else {
        console.info(`[TaskList] task ${id} patched:`, data)
        // #8: use server response, not just the request payload
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updated } : t))
      }
    } catch (err) {
      console.error(`[TaskList] patchTask(${id}) failed:`, err)
      setError(err.message)
    }
  }, [load])

  const handleDeleteTask = useCallback(async (id) => {
    if (!window.confirm('Delete this task?')) return
    try {
      await deleteTask(id)
      console.info(`[TaskList] task ${id} deleted`) // #17
      setTasks(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      console.error(`[TaskList] deleteTask(${id}) failed:`, err) // #6, #16
      setError(err.message)
    }
  }, [])

  const handleCreateTask = useCallback(async () => {
    if (!newTask.title.trim()) return
    const payload = {
      title: newTask.title.trim(),
      priority: newTask.priority,
      due_date: newTask.due_date || null,
      // #2: explicit radix
      estimated_minutes: newTask.estimated_minutes ? parseInt(newTask.estimated_minutes, 10) : null,
      assignee_id:       newTask.assignee_id       ? parseInt(newTask.assignee_id, 10)       : null,
      category_id:       newTask.category_id       ? parseInt(newTask.category_id, 10)       : null,
      recurrence: newTask.recurrence,
    }
    try {
      const created = await createTask(payload)
      console.info('[TaskList] task created:', created.id, created.title) // #17
      setTasks(prev => [created, ...prev])
      setNewTask(emptyTask())
      setAddingTask(false)
    } catch (err) {
      console.error('[TaskList] createTask failed:', err) // #6, #16
      setError(err.message)
    }
  }, [newTask])

  const handleNewTaskChange = useCallback((field, value) =>
    setNewTask(p => ({ ...p, [field]: value })),
  [])

  const startEdit = useCallback((task) => {
    setEditingId(task.id)
    setEditForm({
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      due_date: task.due_date || '',
      estimated_minutes: task.estimated_minutes ?? '',
      assignee_id: task.assignee_id ?? '',
      category_id: task.category_id ?? '',
      recurrence: task.recurrence || 'none',
      status: task.status,
    })
  }, [])

  // #7: reads editForm via ref so this callback never needs to be recreated
  // #8: uses server response to update state
  const saveEdit = useCallback(async (taskId) => {
    const form = editFormRef.current
    const payload = {
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
      due_date: form.due_date || null,
      // #2: explicit radix
      estimated_minutes: form.estimated_minutes ? parseInt(form.estimated_minutes, 10) : null,
      assignee_id:       form.assignee_id       ? parseInt(form.assignee_id, 10)       : null,
      category_id:       form.category_id       ? parseInt(form.category_id, 10)       : null,
      recurrence: form.recurrence,
      status: form.status,
    }
    try {
      const updated = await updateTask(taskId, payload)
      console.info(`[TaskList] task ${taskId} updated`) // #17
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updated } : t))
      setEditingId(null)
    } catch (err) {
      console.error(`[TaskList] saveEdit(${taskId}) failed:`, err) // #6, #16
      setError(err.message)
    }
  }, []) // stable — reads editForm via ref

  const cancelEdit   = useCallback(() => setEditingId(null), [])

  const handleEditFormChange = useCallback((field, value) =>
    setEditForm(p => ({ ...p, [field]: value })),
  [])

  // #7: reads newSubtask via ref so this callback stays stable across keystrokes
  const handleAddSubtask = useCallback(async (taskId) => {
    const title = (newSubtaskRef.current[taskId] || '').trim()
    if (!title) return
    try {
      const sub = await createSubtask(taskId, { title })
      console.info(`[TaskList] subtask created for task ${taskId}:`, sub.id) // #17
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), sub] } : t
      ))
      setNewSubtask(prev => ({ ...prev, [taskId]: '' }))
    } catch (err) {
      console.error(`[TaskList] createSubtask(${taskId}) failed:`, err) // #6, #16
      setError(err.message)
    }
  }, []) // stable — reads newSubtask via ref

  const changeNewSubtask = useCallback((taskId, title) =>
    setNewSubtask(p => ({ ...p, [taskId]: title })),
  [])

  const patchSubtask = useCallback(async (taskId, subtaskId, data) => {
    try {
      await updateSubtask(taskId, subtaskId, data)
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, subtasks: t.subtasks.map(s => s.id === subtaskId ? { ...s, ...data } : s) }
          : t
      ))
    } catch (err) {
      console.error(`[TaskList] patchSubtask(${taskId}, ${subtaskId}) failed:`, err) // #6, #16
      setError(err.message)
    }
  }, [])

  const startEditSubtask = useCallback((taskId, sub) => {
    setEditingSubtask({ taskId, subtaskId: sub.id })
    setEditSubForm({ title: sub.title, due_date: sub.due_date || '', status: sub.status })
  }, [])

  // #7: reads editingSubtask + editSubForm via ref so this stays stable
  const saveEditSubtask = useCallback(async () => {
    const { editingSubtask: es, editSubForm: esf } = editSubRef.current
    if (!es) return
    const { taskId, subtaskId } = es
    const payload = {
      title: esf.title.trim(),
      due_date: esf.due_date || null,
      status: esf.status,
    }
    try {
      await updateSubtask(taskId, subtaskId, payload)
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, subtasks: t.subtasks.map(s => s.id === subtaskId ? { ...s, ...payload } : s) }
          : t
      ))
      setEditingSubtask(null)
    } catch (err) {
      console.error(`[TaskList] saveEditSubtask(${taskId}, ${subtaskId}) failed:`, err) // #6, #16
      setError(err.message)
    }
  }, []) // stable — reads state via ref

  const cancelEditSubtask = useCallback(() => setEditingSubtask(null), [])

  const handleEditSubFormChange = useCallback((field, value) =>
    setEditSubForm(p => ({ ...p, [field]: value })),
  [])

  const handleDeleteSubtask = useCallback(async (taskId, subtaskId) => {
    try {
      await deleteSubtask(taskId, subtaskId)
      console.info(`[TaskList] subtask ${subtaskId} deleted from task ${taskId}`) // #17
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: t.subtasks.filter(s => s.id !== subtaskId) } : t
      ))
    } catch (err) {
      console.error(`[TaskList] deleteSubtask(${taskId}, ${subtaskId}) failed:`, err) // #6, #16
      setError(err.message)
    }
  }, [])

  const toggleExpand = useCallback((id) =>
    setExpanded(p => ({ ...p, [id]: !p[id] })),
  [])

  return (
    <div className="card">
      {/* Toolbar */}
      <div className="toolbar">
        <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '.95rem' }}>Filter:</span>

        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className="btn"
            title={`${filterStatus.includes(s) ? 'Hide' : 'Show'} tasks with status: ${STATUS_LABELS[s]}`}
            style={{
              background: filterStatus.includes(s) ? STATUS_BG[s] : '#f1f5f9',
              color: filterStatus.includes(s) ? STATUS_FG[s] : '#64748b',
              border: filterStatus.includes(s) ? `1px solid ${STATUS_FG[s]}` : '1px solid #e2e8f0',
            }}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}

        <button
          className="btn"
          onClick={() => setFilterToday(v => !v)}
          title="Show only tasks due today"
          style={{
            background: filterToday ? '#ede9fe' : '#f1f5f9',
            color: filterToday ? '#6d28d9' : '#64748b',
            border: filterToday ? '1px solid #6d28d9' : '1px solid #e2e8f0',
          }}
        >
          Today
        </button>

        <button
          className="btn"
          onClick={() => setFilterTomorrow(v => !v)}
          title="Show only tasks due tomorrow"
          style={{
            background: filterTomorrow ? '#ede9fe' : '#f1f5f9',
            color: filterTomorrow ? '#6d28d9' : '#64748b',
            border: filterTomorrow ? '1px solid #6d28d9' : '1px solid #e2e8f0',
          }}
        >
          Tomorrow
        </button>

        <label style={{ fontSize: '.875rem', color: '#475569' }}>
          Category&nbsp;
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </label>

        <label style={{ fontSize: '.875rem', color: '#475569' }}>
          Assignee&nbsp;
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            <option value="unassigned">Unassigned</option>
            {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <button
          className="btn btn-gray"
          style={{ marginLeft: 'auto' }}
          onClick={load}
          disabled={loading}
          title="Reload tasks from the server"
        >
          ↻ Refresh
        </button>

        <button
          className="btn btn-blue"
          onClick={() => setAddingTask(v => !v)}
          title="Open the form to create a new task"
        >
          + New Task
        </button>
      </div>

      {/* #5, #6, #16: error banner — shown when any load or CRUD operation fails */}
      {error && (
        <div style={{
          background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5',
          borderRadius: '6px', padding: '.6rem 1rem', marginBottom: '1rem', fontSize: '.875rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: '1.1rem', padding: '0 .25rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* #15: visible hint when the server-side fetch limit is reached */}
      {!loading && tasks.length >= TASK_FETCH_LIMIT && (
        <div style={{
          background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a',
          borderRadius: '6px', padding: '.5rem 1rem', marginBottom: '1rem', fontSize: '.85rem',
        }}>
          Showing the first {TASK_FETCH_LIMIT} tasks — some may not be visible.
        </div>
      )}

      {/* New task form — isolated sub-component (#14) */}
      {addingTask && (
        <NewTaskForm
          newTask={newTask}
          onChange={handleNewTaskChange}
          onSubmit={handleCreateTask}
          onCancel={() => setAddingTask(false)}
          persons={persons}
          categories={categories}
        />
      )}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : filterStatus.length === 0 ? (
        // #10: distinguish "all filters off" from "genuinely no matching tasks"
        <div className="empty">All status filters are off — enable at least one to see tasks.</div>
      ) : visible.length === 0 ? (
        <div className="empty">No tasks match the current filters.</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Title</th>
                <th>Priority</th>
                <th>Due</th>
                {filterStatus.includes('done') && <th>Completed</th>}
                <th>Est.</th>
                <th>Assignee</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  expanded={!!expanded[task.id]}
                  onToggleExpand={toggleExpand}
                  isEditing={editingId === task.id}
                  // Pass editForm only to the editing row so other rows don't
                  // re-render when the user types (#14 perf)
                  editForm={editingId === task.id ? editForm : undefined}
                  onEditFormChange={handleEditFormChange}
                  onStartEdit={startEdit}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
                  // Same scoping for subtask edit state
                  editingSubtaskId={editingSubtask?.taskId === task.id ? editingSubtask.subtaskId : null}
                  editSubForm={editingSubtask?.taskId === task.id ? editSubForm : undefined}
                  onEditSubFormChange={handleEditSubFormChange}
                  onStartEditSubtask={startEditSubtask}
                  onSaveEditSubtask={saveEditSubtask}
                  onCancelEditSubtask={cancelEditSubtask}
                  newSubtaskTitle={newSubtask[task.id] || ''}
                  onNewSubtaskChange={changeNewSubtask}
                  onAddSubtask={handleAddSubtask}
                  onPatchTask={patchTask}
                  onDeleteTask={handleDeleteTask}
                  onPatchSubtask={patchSubtask}
                  onDeleteSubtask={handleDeleteSubtask}
                  persons={persons}
                  categories={categories}
                  showCompleted={filterStatus.includes('done')}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
