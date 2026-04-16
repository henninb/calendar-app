import React, { useState, useRef, useEffect, useCallback } from 'react'
import { isOverdue, fmt, withAlpha, STATUS_LABELS, STATUS_OPTIONS } from './helpers'

const inlineCls = `text-sm px-2 py-0.5 rounded-lg border border-blue-400 dark:border-blue-500
  bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200
  focus:outline-none focus:ring-2 focus:ring-blue-500/50`

// Static class strings — must be complete so Tailwind's scanner picks them up
const PRIORITY_STRIPE = {
  high:   'border-l-red-500 dark:border-l-red-500',
  medium: 'border-l-amber-500 dark:border-l-amber-500',
  low:    'border-l-slate-400 dark:border-l-slate-600',
}

const STATUS_PILL = {
  todo:        'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/25',
  in_progress: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25',
  done:        'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25',
  cancelled:   'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/25',
}

function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const visible = items.filter(item => !item.hidden)
  if (visible.length === 0) return null

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title="More actions"
        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-lg leading-none"
      >
        ···
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden py-1">
          {visible.map(item => (
            <button
              key={item.label}
              onClick={e => { e.stopPropagation(); item.onClick(); setOpen(false) }}
              className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm transition-colors
                ${item.danger
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
              <span className="w-4 text-center opacity-70">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TaskCard({
  task,
  expanded,
  onToggleExpand,
  onEdit,
  onPatchTask,
  onDeleteTask,
  onPatchSubtask,
  persons,
}) {
  const [editingField, setEditingField] = useState(null)

  const overdue = isOverdue(task)
  const subtaskCount = task.subtasks?.length ?? 0
  const doneSubtasks = task.subtasks?.filter(s => s.status === 'done').length ?? 0

  const handleDone = useCallback(
    () => onPatchTask(task.id, { status: 'done' }),
    [onPatchTask, task.id],
  )

  const daysBadge = (() => {
    if (!task.due_date || task.status === 'done' || task.status === 'cancelled') return null
    const diff = Math.ceil((new Date(task.due_date + 'T00:00:00') - new Date()) / 86400000)
    if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, cls: 'text-red-500 dark:text-red-400 font-semibold' }
    if (diff === 0) return { text: 'today', cls: 'text-amber-500 dark:text-amber-400 font-semibold' }
    if (diff <= 3) return { text: `${diff}d`, cls: 'text-amber-500 dark:text-amber-400' }
    return { text: `${diff}d`, cls: 'text-slate-400 dark:text-slate-500' }
  })()

  const menuItems = [
    {
      label: 'Edit',
      icon: '✎',
      onClick: () => onEdit(task),
    },
    {
      label: 'Start',
      icon: '▶',
      hidden: task.status !== 'todo',
      onClick: () => onPatchTask(task.id, { status: 'in_progress' }),
    },
    {
      label: 'Reopen',
      icon: '↩',
      hidden: task.status !== 'done' && task.status !== 'cancelled',
      onClick: () => onPatchTask(task.id, { status: 'todo' }),
    },
    {
      label: 'Cancel',
      icon: '⊘',
      hidden: task.status === 'cancelled' || task.status === 'done',
      onClick: () => onPatchTask(task.id, { status: 'cancelled' }),
    },
    {
      label: 'Delete',
      icon: '✕',
      danger: true,
      onClick: () => onDeleteTask(task.id),
    },
  ]

  const stripeClass = PRIORITY_STRIPE[task.priority] ?? PRIORITY_STRIPE.low
  const isDimmed = task.status === 'done' || task.status === 'cancelled'

  return (
    <div
      className={`
        group relative border-l-4 ${stripeClass}
        bg-white dark:bg-slate-800/80
        border border-l-0 border-slate-200 dark:border-slate-700/60
        rounded-r-xl
        transition-all duration-150
        hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600
        ${overdue ? 'bg-red-50/40 dark:bg-red-950/20' : ''}
        ${isDimmed ? 'opacity-55' : ''}
      `}
    >
      <div className="px-5 py-4">
        {/* Row 1: done-circle · title · status pill · overflow */}
        <div className="flex items-start gap-3.5">
          {/* Circle: click to mark done, or shows checkmark if done */}
          {task.status !== 'done' && task.status !== 'cancelled' ? (
            <button
              onClick={handleDone}
              title="Mark as done"
              className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 border-slate-300 dark:border-slate-600 hover:border-emerald-500 dark:hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all"
            />
          ) : (
            <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 border-2 border-emerald-400 dark:border-emerald-500/60 flex items-center justify-center">
              <span className="text-emerald-600 dark:text-emerald-400 text-[10px] leading-none font-bold">✓</span>
            </div>
          )}

          <span
            className={`flex-1 min-w-0 text-base font-medium leading-snug
              ${task.status === 'done'
                ? 'line-through text-slate-400 dark:text-slate-500'
                : 'text-slate-800 dark:text-slate-100'
              }`}
          >
            {task.title}
          </span>

          {/* Start button — visible only on todo tasks, hidden while editing status */}
          {task.status === 'todo' && editingField !== 'status' && (
            <button
              onClick={() => onPatchTask(task.id, { status: 'in_progress' })}
              title="Start task"
              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold
                bg-amber-50 text-amber-700 border border-amber-200
                hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25
                dark:hover:bg-amber-500/20 transition-colors"
            >
              ▶ Start
            </button>
          )}

          {/* Status — click pill to edit inline */}
          {editingField === 'status' ? (
            <select
              autoFocus
              defaultValue={task.status}
              onChange={e => { onPatchTask(task.id, { status: e.target.value }); setEditingField(null) }}
              onBlur={() => setEditingField(null)}
              onKeyDown={e => e.key === 'Escape' && setEditingField(null)}
              className={`flex-shrink-0 ${inlineCls}`}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingField('status')}
              title="Click to edit status"
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity hover:opacity-75 ${STATUS_PILL[task.status] ?? STATUS_PILL.todo}`}
            >
              {STATUS_LABELS[task.status]}
            </button>
          )}

          <OverflowMenu items={menuItems} />
        </div>

        {/* Row 2: category badge + recurrence badge */}
        {(task.category || (task.recurrence && task.recurrence !== 'none')) && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5 ml-9">
            {task.category && (
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold"
                style={{
                  background: withAlpha(task.category.color, 0.12),
                  color: task.category.color,
                  border: `1px solid ${withAlpha(task.category.color, 0.28)}`,
                }}
              >
                {task.category.icon} {task.category.name}
              </span>
            )}
            {task.recurrence && task.recurrence !== 'none' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20">
                ↻ {task.recurrence}
              </span>
            )}
          </div>
        )}

        {/* Row 3: metadata (date · assignee · est. time) */}
        {(task.due_date || task.assignee || task.estimated_minutes) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2.5 ml-9 text-sm text-slate-500 dark:text-slate-400">
            {task.due_date && (
              editingField === 'due_date' ? (
                <span className="flex items-center gap-1.5">
                  <span className="opacity-60">📅</span>
                  <input
                    type="date"
                    autoFocus
                    defaultValue={task.due_date}
                    onChange={e => {
                      if (e.target.value) {
                        onPatchTask(task.id, { due_date: e.target.value })
                        setEditingField(null)
                      }
                    }}
                    onBlur={e => {
                      onPatchTask(task.id, { due_date: e.target.value || null })
                      setEditingField(null)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { onPatchTask(task.id, { due_date: e.target.value || null }); setEditingField(null) }
                      if (e.key === 'Escape') setEditingField(null)
                    }}
                    className="text-sm px-2 py-0.5 rounded-lg border border-blue-400 dark:border-blue-500
                      bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200
                      focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </span>
              ) : (
                <button
                  onClick={() => setEditingField('due_date')}
                  title="Click to edit due date"
                  className="flex items-center gap-1.5 hover:text-blue-500 dark:hover:text-blue-400 transition-colors group/date"
                >
                  <span className="opacity-60">📅</span>
                  <span className="border-b border-dashed border-transparent group-hover/date:border-blue-400 transition-colors">
                    {fmt(task.due_date)}
                  </span>
                  {daysBadge && (
                    <span className={daysBadge.cls}>· {daysBadge.text}</span>
                  )}
                </button>
              )
            )}
            {/* Assignee — always show so it's clickable even when unassigned */}
            {editingField === 'assignee_id' ? (
              <span className="flex items-center gap-1.5">
                <span className="opacity-60">👤</span>
                <select
                  autoFocus
                  defaultValue={task.assignee_id ?? ''}
                  onChange={e => { onPatchTask(task.id, { assignee_id: e.target.value || null }); setEditingField(null) }}
                  onBlur={() => setEditingField(null)}
                  onKeyDown={e => e.key === 'Escape' && setEditingField(null)}
                  className={inlineCls}
                >
                  <option value="">Unassigned</option>
                  {(persons ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </span>
            ) : (
              <button
                onClick={() => setEditingField('assignee_id')}
                title="Click to edit assignee"
                className="flex items-center gap-1.5 hover:text-blue-500 dark:hover:text-blue-400 transition-colors group/assignee"
              >
                <span className="opacity-60">👤</span>
                <span className="border-b border-dashed border-transparent group-hover/assignee:border-blue-400 transition-colors">
                  {task.assignee?.name ?? 'Unassigned'}
                </span>
              </button>
            )}

            {/* Duration — always show so it's clickable even when empty */}
            {editingField === 'estimated_minutes' ? (
              <span className="flex items-center gap-1.5">
                <span className="opacity-60">⏱</span>
                <input
                  type="number"
                  autoFocus
                  min="1"
                  defaultValue={task.estimated_minutes ?? ''}
                  placeholder="min"
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onPatchTask(task.id, { estimated_minutes: parseInt(e.target.value, 10) || null }); setEditingField(null) }
                    if (e.key === 'Escape') setEditingField(null)
                  }}
                  onBlur={e => { onPatchTask(task.id, { estimated_minutes: parseInt(e.target.value, 10) || null }); setEditingField(null) }}
                  className={`w-20 ${inlineCls}`}
                />
              </span>
            ) : (
              <button
                onClick={() => setEditingField('estimated_minutes')}
                title="Click to edit duration"
                className="flex items-center gap-1.5 hover:text-blue-500 dark:hover:text-blue-400 transition-colors group/dur"
              >
                <span className="opacity-60">⏱</span>
                <span className="border-b border-dashed border-transparent group-hover/dur:border-blue-400 transition-colors">
                  {task.estimated_minutes ? `${task.estimated_minutes}m` : 'No duration'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Row 4: subtask progress bar + expand toggle */}
        {subtaskCount > 0 && (
          <div className="flex items-center gap-2.5 mt-3.5 ml-9">
            <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${(doneSubtasks / subtaskCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0 tabular-nums">
              {doneSubtasks}/{subtaskCount}
            </span>
            <button
              onClick={() => onToggleExpand(task.id)}
              className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors flex-shrink-0"
            >
              {expanded ? '▾ hide' : '▸ subtasks'}
            </button>
          </div>
        )}
      </div>

      {/* Expanded: description + subtask checklist */}
      {expanded && subtaskCount > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 pb-3 pt-2.5 ml-4">
          {task.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">{task.description}</p>
          )}
          <div className="space-y-2">
            {[...(task.subtasks ?? [])].sort((a, b) => a.order - b.order).map(sub => (
              <label key={sub.id} className="flex items-center gap-2.5 cursor-pointer group/sub">
                <input
                  type="checkbox"
                  checked={sub.status === 'done'}
                  onChange={e =>
                    onPatchSubtask(task.id, sub.id, { status: e.target.checked ? 'done' : 'todo' })
                  }
                  className="w-4 h-4 rounded accent-emerald-500 cursor-pointer flex-shrink-0"
                />
                <span
                  className={`text-sm flex-1 leading-snug transition-colors
                    ${sub.status === 'done'
                      ? 'line-through text-slate-400 dark:text-slate-500'
                      : 'text-slate-700 dark:text-slate-300 group-hover/sub:text-slate-900 dark:group-hover/sub:text-slate-100'
                    }`}
                >
                  {sub.title}
                </span>
                {sub.due_date && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">{fmt(sub.due_date)}</span>
                )}
              </label>
            ))}
          </div>
          {/* Nudge toward the edit panel for add/edit/delete */}
          <button
            onClick={() => onEdit(task)}
            className="mt-3 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
          >
            <span>✎</span> Add or edit subtasks…
          </button>
        </div>
      )}
    </div>
  )
}
