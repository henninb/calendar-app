import React, { useState, useEffect, useCallback } from 'react'
import {
  fetchTasks, fetchPersons, fetchCategories, createTask, updateTask, deleteTask,
  createSubtask, updateSubtask, deleteSubtask,
} from '../api'

const STATUS_OPTIONS = ['todo', 'in_progress', 'done', 'cancelled']
const STATUS_LABELS  = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled' }

const PRIORITY_COLORS = { low: '#64748b', medium: '#d97706', high: '#dc2626' }
const STATUS_BG = { todo: '#dbeafe', in_progress: '#fef3c7', done: '#dcfce7', cancelled: '#f1f5f9' }
const STATUS_FG = { todo: '#1d4ed8', in_progress: '#92400e', done: '#15803d', cancelled: '#64748b' }

function fmt(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

const emptyTask = () => ({ title: '', priority: 'medium', due_date: localDate(), estimated_minutes: '', assignee_id: '', category_id: '', recurrence: 'none' })

export default function TaskList() {
  const [tasks, setTasks]           = useState([])
  const [persons, setPersons]       = useState([])
  const [categories, setCategories] = useState([])
  const [filterStatus, setFilter]   = useState(['todo', 'in_progress'])
  const [filterAssignee, setFAsgn]  = useState('')
  const [filterCategory, setFCat]   = useState('')
  const [filterTomorrow, setFilterTomorrow] = useState(false)
  const [filterToday, setFilterToday]       = useState(false)
  const [expanded, setExpanded]     = useState({})
  const [newSubtask, setNewSubtask] = useState({})
  const [addingTask, setAddingTask] = useState(false)
  const [newTask, setNewTask]       = useState(emptyTask)
  const [editingId, setEditingId]         = useState(null)
  const [editForm, setEditForm]           = useState({})
  const [editingSubtask, setEditingSubtask] = useState(null)   // { taskId, subtaskId }
  const [editSubForm, setEditSubForm]     = useState({})
  const [loading, setLoading]       = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, p, c] = await Promise.all([fetchTasks(), fetchPersons(), fetchCategories()])
      setTasks(t)
      setPersons(p)
      setCategories(c)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleStatus = (s) =>
    setFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const today    = localDate(0)
  const tomorrow = localDate(1)

  const visible = tasks
    .filter(t => {
      if (filterStatus.length && !filterStatus.includes(t.status)) return false
      if (filterAssignee === 'unassigned') { if (t.assignee_id != null) return false }
      else if (filterAssignee && String(t.assignee_id) !== filterAssignee) return false
      if (filterToday && t.due_date !== today) return false
      if (filterTomorrow && t.due_date !== tomorrow) return false
      if (filterCategory && String(t.category_id) !== filterCategory) return false
      return true
    })
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
    })

  const patchTask = async (id, data) => {
    const updated = await updateTask(id, data)
    // If a recurring task was just marked done, the server spawned a new one — reload
    if (data.status === 'done') {
      await load()
    } else {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
    }
  }

  const handleDeleteTask = async (id) => {
    if (!window.confirm('Delete this task?')) return
    await deleteTask(id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) return
    const payload = {
      title: newTask.title.trim(),
      priority: newTask.priority,
      due_date: newTask.due_date || null,
      estimated_minutes: newTask.estimated_minutes ? parseInt(newTask.estimated_minutes) : null,
      assignee_id: newTask.assignee_id ? parseInt(newTask.assignee_id) : null,
      category_id: newTask.category_id ? parseInt(newTask.category_id) : null,
      recurrence: newTask.recurrence,
    }
    const created = await createTask(payload)
    setTasks(prev => [created, ...prev])
    setNewTask(emptyTask())
    setAddingTask(false)
  }

  const startEdit = (task) => {
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
  }

  const saveEdit = async (taskId) => {
    const payload = {
      title: editForm.title.trim(),
      description: editForm.description || null,
      priority: editForm.priority,
      due_date: editForm.due_date || null,
      estimated_minutes: editForm.estimated_minutes ? parseInt(editForm.estimated_minutes) : null,
      assignee_id: editForm.assignee_id ? parseInt(editForm.assignee_id) : null,
      category_id: editForm.category_id ? parseInt(editForm.category_id) : null,
      recurrence: editForm.recurrence,
      status: editForm.status,
    }
    await updateTask(taskId, payload)
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t, ...payload,
      assignee: persons.find(p => p.id === payload.assignee_id) || null,
      category: categories.find(c => c.id === payload.category_id) || null,
    } : t))
    setEditingId(null)
  }

  const handleAddSubtask = async (taskId) => {
    const title = (newSubtask[taskId] || '').trim()
    if (!title) return
    const sub = await createSubtask(taskId, { title })
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), sub] } : t
    ))
    setNewSubtask(prev => ({ ...prev, [taskId]: '' }))
  }

  const patchSubtask = async (taskId, subtaskId, data) => {
    await updateSubtask(taskId, subtaskId, data)
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, subtasks: t.subtasks.map(s => s.id === subtaskId ? { ...s, ...data } : s) }
        : t
    ))
  }

  const startEditSubtask = (taskId, sub) => {
    setEditingSubtask({ taskId, subtaskId: sub.id })
    setEditSubForm({ title: sub.title, due_date: sub.due_date || '', status: sub.status })
  }

  const saveEditSubtask = async () => {
    const { taskId, subtaskId } = editingSubtask
    const payload = {
      title: editSubForm.title.trim(),
      due_date: editSubForm.due_date || null,
      status: editSubForm.status,
    }
    await updateSubtask(taskId, subtaskId, payload)
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, subtasks: t.subtasks.map(s => s.id === subtaskId ? { ...s, ...payload } : s) }
        : t
    ))
    setEditingSubtask(null)
  }

  const handleDeleteSubtask = async (taskId, subtaskId) => {
    await deleteSubtask(taskId, subtaskId)
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, subtasks: t.subtasks.filter(s => s.id !== subtaskId) } : t
    ))
  }

  const inputStyle = {
    border: '1px solid #cbd5e1', borderRadius: '6px', padding: '.35rem .65rem',
    fontSize: '.875rem', background: '#fff', color: '#1e293b',
  }
  const labelStyle = { fontSize: '.8rem', color: '#475569', display: 'block', marginBottom: '.2rem' }

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
          <select value={filterCategory} onChange={e => setFCat(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </label>

        <label style={{ fontSize: '.875rem', color: '#475569' }}>
          Assignee&nbsp;
          <select value={filterAssignee} onChange={e => setFAsgn(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            <option value="unassigned">Unassigned</option>
            {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <button
          className="btn btn-blue"
          style={{ marginLeft: 'auto' }}
          onClick={() => setAddingTask(v => !v)}
          title="Open the form to create a new task"
        >
          + New Task
        </button>
      </div>

      {/* New task form */}
      {addingTask && (
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
              onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleCreateTask()}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
              placeholder="Task title"
            />
          </div>
          <div>
            <label style={labelStyle}>Recurrence</label>
            <select value={newTask.recurrence} onChange={e => setNewTask(p => ({ ...p, recurrence: e.target.value }))} style={inputStyle}>
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
            <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))} style={inputStyle}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Due date</label>
            <input type="date" value={newTask.due_date} onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Est. minutes</label>
            <input type="number" min="1" value={newTask.estimated_minutes}
              onChange={e => setNewTask(p => ({ ...p, estimated_minutes: e.target.value }))}
              style={{ ...inputStyle, width: '90px' }} />
          </div>
          <div>
            <label style={labelStyle}>Assignee</label>
            <select value={newTask.assignee_id} onChange={e => setNewTask(p => ({ ...p, assignee_id: e.target.value }))} style={inputStyle}>
              <option value="">Unassigned</option>
              {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select value={newTask.category_id} onChange={e => setNewTask(p => ({ ...p, category_id: e.target.value }))} style={inputStyle}>
              <option value="">None</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button onClick={handleCreateTask} className="btn btn-green" title="Save and create this task">Add</button>
            <button onClick={() => setAddingTask(false)} className="btn btn-gray" title="Discard and close the new task form">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading…</div>
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
                <th>Est.</th>
                <th>Assignee</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(task => (
                <React.Fragment key={task.id}>
                  <tr style={task.due_date && new Date(task.due_date + 'T00:00:00') < new Date() && task.status !== 'done' && task.status !== 'cancelled' ? { background: '#fee2e2' } : {}}>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '.2rem .55rem', borderRadius: '4px',
                        fontSize: '.78rem', fontWeight: 700,
                        background: STATUS_BG[task.status], color: STATUS_FG[task.status],
                      }}>
                        {STATUS_LABELS[task.status]}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => setExpanded(p => ({ ...p, [task.id]: !p[task.id] }))}
                        title={expanded[task.id] ? 'Collapse subtasks' : 'Expand subtasks'}
                        style={{ background: 'none', border: 'none', color: '#1e293b', cursor: 'pointer', padding: 0, textAlign: 'left', fontSize: '.875rem', fontWeight: 500 }}
                      >
                        {expanded[task.id] ? '▾' : '▸'} {task.title}
                      </button>
                      {task.category && (
                        <span style={{
                          fontSize: '.72rem', marginLeft: '.5rem', fontWeight: 600,
                          background: task.category.color + '22', color: task.category.color,
                          border: `1px solid ${task.category.color}55`,
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
                      {task.priority}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '.875rem' }}>
                      {fmt(task.due_date)}{daysBadge(task.due_date)}
                    </td>
                    <td style={{ color: '#64748b', fontSize: '.875rem' }}>
                      {task.estimated_minutes ? `${task.estimated_minutes}m` : '—'}
                    </td>
                    <td style={{ color: '#475569', fontSize: '.875rem' }}>
                      {task.assignee?.name ?? '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                        {task.status !== 'done' && (
                          <button className="btn btn-green" title="Mark this task as done" onClick={() => patchTask(task.id, { status: 'done' })}>✓ Done</button>
                        )}
                        {task.status === 'todo' && (
                          <button className="btn" title="Mark this task as in progress" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #d97706' }}
                            onClick={() => patchTask(task.id, { status: 'in_progress' })}>Start</button>
                        )}
                        {task.status !== 'cancelled' && task.status !== 'done' && (
                          <button className="btn btn-gray" title="Cancel this task" onClick={() => patchTask(task.id, { status: 'cancelled' })}>Cancel</button>
                        )}
                        <button className="btn btn-blue" title="Edit this task's details" onClick={() => startEdit(task)}>Edit</button>
                        <button className="btn btn-red" title="Permanently delete this task" onClick={() => handleDeleteTask(task.id)}>Del</button>
                      </div>
                    </td>
                  </tr>

                  {/* Inline edit form */}
                  {editingId === task.id && (
                    <tr>
                      <td colSpan={7} style={{ background: '#f8fafc', padding: '1rem 1rem 1rem 2.5rem', borderBottom: '2px solid #3b82f6' }}>
                        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                          <div style={{ flex: '2 1 220px' }}>
                            <label style={labelStyle}>Title *</label>
                            <input
                              autoFocus
                              value={editForm.title}
                              onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && saveEdit(task.id)}
                              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                            />
                          </div>
                          <div style={{ flex: '2 1 180px' }}>
                            <label style={labelStyle}>Description</label>
                            <input
                              value={editForm.description}
                              onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                              placeholder="Optional"
                            />
                          </div>
                          <div>
                            <label style={labelStyle}>Status</label>
                            <select value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))} style={inputStyle}>
                              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>Recurrence</label>
                            <select value={editForm.recurrence} onChange={e => setEditForm(p => ({ ...p, recurrence: e.target.value }))} style={inputStyle}>
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
                            <select value={editForm.priority} onChange={e => setEditForm(p => ({ ...p, priority: e.target.value }))} style={inputStyle}>
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>Due date</label>
                            <input type="date" value={editForm.due_date} onChange={e => setEditForm(p => ({ ...p, due_date: e.target.value }))} style={inputStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>Est. minutes</label>
                            <input type="number" min="1" value={editForm.estimated_minutes}
                              onChange={e => setEditForm(p => ({ ...p, estimated_minutes: e.target.value }))}
                              style={{ ...inputStyle, width: '90px' }} />
                          </div>
                          <div>
                            <label style={labelStyle}>Assignee</label>
                            <select value={editForm.assignee_id} onChange={e => setEditForm(p => ({ ...p, assignee_id: e.target.value }))} style={inputStyle}>
                              <option value="">Unassigned</option>
                              {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>Category</label>
                            <select value={editForm.category_id} onChange={e => setEditForm(p => ({ ...p, category_id: e.target.value }))} style={inputStyle}>
                              <option value="">None</option>
                              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: '.5rem' }}>
                            <button onClick={() => saveEdit(task.id)} className="btn btn-green" title="Save changes to this task">Save</button>
                            <button onClick={() => setEditingId(null)} className="btn btn-gray" title="Discard changes and close the edit form">Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Expanded subtasks */}
                  {expanded[task.id] && (
                    <tr>
                      <td colSpan={7} style={{ background: '#f8fafc', paddingLeft: '2.5rem', paddingBottom: '.75rem' }}>
                        {task.description && (
                          <p style={{ color: '#475569', fontSize: '.85rem', margin: '.4rem 0 .75rem' }}>{task.description}</p>
                        )}

                        <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.5rem' }}>
                          Subtasks
                        </div>

                        {(task.subtasks || []).sort((a, b) => a.order - b.order).map(sub => (
                          <div key={sub.id} style={{ marginBottom: '.35rem' }}>
                            {editingSubtask?.taskId === task.id && editingSubtask?.subtaskId === sub.id ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                                <input
                                  autoFocus
                                  value={editSubForm.title}
                                  onChange={e => setEditSubForm(p => ({ ...p, title: e.target.value }))}
                                  onKeyDown={e => e.key === 'Enter' && saveEditSubtask()}
                                  style={{ ...inputStyle, flex: '1 1 160px' }}
                                />
                                <input
                                  type="date"
                                  value={editSubForm.due_date}
                                  onChange={e => setEditSubForm(p => ({ ...p, due_date: e.target.value }))}
                                  style={inputStyle}
                                />
                                <select
                                  value={editSubForm.status}
                                  onChange={e => setEditSubForm(p => ({ ...p, status: e.target.value }))}
                                  style={{ ...inputStyle, background: STATUS_BG[editSubForm.status], color: STATUS_FG[editSubForm.status], fontWeight: 600 }}
                                >
                                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                                </select>
                                <button onClick={saveEditSubtask} className="btn btn-green" title="Save subtask">Save</button>
                                <button onClick={() => setEditingSubtask(null)} className="btn btn-gray" title="Cancel edit">Cancel</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                                <input
                                  type="checkbox"
                                  checked={sub.status === 'done'}
                                  onChange={e => patchSubtask(task.id, sub.id, { status: e.target.checked ? 'done' : 'todo' })}
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
                                  onChange={e => patchSubtask(task.id, sub.id, { status: e.target.value })}
                                  style={{ fontSize: '.78rem', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '.15rem .3rem', background: STATUS_BG[sub.status], color: STATUS_FG[sub.status], fontWeight: 600, cursor: 'pointer' }}
                                >
                                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                                </select>
                                <button onClick={() => startEditSubtask(task.id, sub)}
                                  title="Edit this subtask"
                                  style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '.9rem', padding: '0 .2rem' }}>
                                  ✎
                                </button>
                                <button onClick={() => handleDeleteSubtask(task.id, sub.id)}
                                  title="Delete this subtask"
                                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '.9rem', padding: '0 .2rem' }}>
                                  ✕
                                </button>
                              </div>
                            )}
                          </div>
                        ))}

                        <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem' }}>
                          <input
                            placeholder="Add subtask…"
                            value={newSubtask[task.id] || ''}
                            onChange={e => setNewSubtask(p => ({ ...p, [task.id]: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && handleAddSubtask(task.id)}
                            style={{ ...inputStyle, flex: 1 }}
                          />
                          <button onClick={() => handleAddSubtask(task.id)} className="btn btn-blue" title="Add this subtask">Add</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
