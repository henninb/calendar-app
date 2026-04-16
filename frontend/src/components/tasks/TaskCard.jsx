import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isOverdue, fmt, withAlpha, STATUS_LABELS, STATUS_OPTIONS, getDaysBadge } from './helpers'

const inlineCls = `text-sm px-2 py-0.5 rounded-lg border border-blue-400 dark:border-blue-500
  bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200
  focus:outline-none focus:ring-2 focus:ring-blue-500/50`

// Static class strings — must be complete so Tailwind's scanner picks them up
const PRIORITY_STRIPE = {
  high:   'border-l-red-500   dark:border-l-red-500   hover:border-l-red-600   dark:hover:border-l-red-400',
  medium: 'border-l-amber-500 dark:border-l-amber-500 hover:border-l-amber-600 dark:hover:border-l-amber-400',
  low:    'border-l-slate-400 dark:border-l-slate-600 hover:border-l-slate-500 dark:hover:border-l-slate-500',
}

const STATUS_PILL = {
  todo:        'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/25',
  in_progress: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25',
  done:        'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25',
  cancelled:   'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/25',
}

const STATUS_ICON = {
  todo:        '○',
  in_progress: '◑',
  done:        '✓',
  cancelled:   '✕',
}

const subtaskInputCls = `flex-1 text-sm px-2.5 py-1.5 rounded-lg
  border border-slate-200 dark:border-slate-600
  bg-white dark:bg-slate-700/60
  text-slate-800 dark:text-slate-200
  placeholder-slate-400 dark:placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-blue-500/40`

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

function SubtaskConfirmModal({ task, incompleteSubtasks, onCompleteAll, onDoneAnyway, onCancel }) {
  useEffect(() => {
    function handle(e) { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="mt-0.5 w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-600 dark:text-amber-400 text-base">⚠</span>
            </div>
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm leading-snug">
                Incomplete subtasks
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                "{task.title}" has {incompleteSubtasks.length} subtask{incompleteSubtasks.length !== 1 ? 's' : ''} still open.
              </p>
            </div>
          </div>
          <ul className="space-y-1.5 pl-1">
            {incompleteSubtasks.map(sub => (
              <li key={sub.id} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="w-3.5 h-3.5 rounded border-2 border-slate-300 dark:border-slate-600 flex-shrink-0" />
                <span className="truncate">{sub.title}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-5 pb-5 flex flex-col gap-2">
          <button
            onClick={onCompleteAll}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold
              bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700
              text-white transition-colors shadow-sm"
          >
            <span>✓</span> Complete all &amp; mark done
          </button>
          <button
            onClick={onDoneAnyway}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold
              bg-slate-100 hover:bg-slate-200 active:bg-slate-300
              dark:bg-slate-700 dark:hover:bg-slate-600 dark:active:bg-slate-500
              text-slate-700 dark:text-slate-200 transition-colors"
          >
            Mark done anyway
          </button>
          <button
            onClick={onCancel}
            className="w-full px-4 py-2 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function SortableSubtaskRow({
  sub, taskId, isDimmed,
  editingSubtaskId, editSubtaskTitle,
  onStartEdit, onSaveEdit, onCancelEdit, onEditChange,
  onPatchSubtask, onDeleteSubtask,
}) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: sub.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  }

  const isEditing = editingSubtaskId === sub.id

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 py-0.5 group/sub rounded ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Drag handle — hidden for done/cancelled tasks */}
      {!isDimmed ? (
        <button
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          tabIndex={-1}
          className="cursor-grab active:cursor-grabbing flex-shrink-0 w-4 text-center text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 opacity-0 group-hover/sub:opacity-100 transition-opacity text-xs select-none"
        >
          ⠿
        </button>
      ) : (
        <span className="w-4 flex-shrink-0" />
      )}

      {isEditing ? (
        <>
          <span className="w-4 h-4 flex-shrink-0" />
          <input
            autoFocus
            value={editSubtaskTitle}
            onChange={e => onEditChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            onBlur={onSaveEdit}
            className={`flex-1 text-sm px-2.5 py-1.5 rounded-lg
              border border-slate-200 dark:border-slate-600
              bg-white dark:bg-slate-700/60
              text-slate-800 dark:text-slate-200
              placeholder-slate-400 dark:placeholder-slate-500
              focus:outline-none focus:ring-2 focus:ring-blue-500/40`}
          />
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={onCancelEdit}
            title="Cancel edit"
            className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs flex-shrink-0"
          >✕</button>
        </>
      ) : (
        <>
          <input
            type="checkbox"
            checked={sub.status === 'done'}
            onChange={e =>
              onPatchSubtask(taskId, sub.id, { status: e.target.checked ? 'done' : 'todo' })
            }
            className="w-4 h-4 rounded accent-emerald-500 cursor-pointer flex-shrink-0"
          />
          <span
            onClick={() => !isDimmed && onStartEdit(sub)}
            title={isDimmed ? undefined : 'Click to edit'}
            className={`flex-1 text-sm leading-snug transition-colors min-w-0
              ${sub.status === 'done'
                ? 'line-through text-slate-400 dark:text-slate-500'
                : `text-slate-700 dark:text-slate-300 ${!isDimmed ? 'cursor-text hover:text-slate-900 dark:hover:text-slate-100' : ''}`
              }`}
          >
            {sub.title}
          </span>
          {sub.due_date && (
            <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">{fmt(sub.due_date)}</span>
          )}
          {!isDimmed && (
            <button
              onClick={() => onDeleteSubtask(taskId, sub.id)}
              title="Delete subtask"
              className="w-5 h-5 flex items-center justify-center rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors text-xs flex-shrink-0 opacity-0 group-hover/sub:opacity-100"
            >✕</button>
          )}
        </>
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
  onAddSubtask,
  onDeleteSubtask,
  onReorderSubtasks,
  persons,
  categories,
}) {
  const [editingField, setEditingField] = useState(null)
  const [showSubtaskConfirm, setShowSubtaskConfirm] = useState(false)

  // Inline title edit
  const [editingTitle, setEditingTitle]     = useState(false)
  const [editTitleValue, setEditTitleValue] = useState('')

  // Inline category edit
  const [editingCategory, setEditingCategory] = useState(false)

  // Inline subtask state
  const [editingSubtaskId, setEditingSubtaskId]   = useState(null)
  const [editSubtaskTitle, setEditSubtaskTitle]   = useState('')
  const [newSubtaskTitle, setNewSubtaskTitle]     = useState('')
  const newSubtaskRef   = useRef(null)
  const pendingFocusAdd = useRef(false)

  // After expand triggered by clicking "+ Add subtask", focus the add input
  useEffect(() => {
    if (expanded && pendingFocusAdd.current) {
      pendingFocusAdd.current = false
      setTimeout(() => newSubtaskRef.current?.focus(), 30)
    }
  }, [expanded])

  const overdue        = isOverdue(task)
  const subtaskCount   = task.subtasks?.length ?? 0
  const doneSubtasks   = task.subtasks?.filter(s => s.status === 'done').length ?? 0
  const incompleteSubtasks = task.subtasks?.filter(s => s.status !== 'done' && s.status !== 'cancelled') ?? []
  const sortedSubtasks = [...(task.subtasks ?? [])].sort((a, b) => a.order - b.order)

  // ── Done / subtask confirm ────────────────────────────────────────────────

  const handleDone = useCallback(() => {
    if (incompleteSubtasks.length > 0) {
      setShowSubtaskConfirm(true)
    } else {
      onPatchTask(task.id, { status: 'done' })
    }
  }, [onPatchTask, task.id, incompleteSubtasks.length])

  const handleCompleteAllAndDone = useCallback(async () => {
    setShowSubtaskConfirm(false)
    for (const sub of incompleteSubtasks) {
      await onPatchSubtask(task.id, sub.id, { status: 'done' })
    }
    onPatchTask(task.id, { status: 'done' })
  }, [onPatchSubtask, onPatchTask, task.id, incompleteSubtasks])

  const handleDoneAnyway = useCallback(() => {
    setShowSubtaskConfirm(false)
    onPatchTask(task.id, { status: 'done' })
  }, [onPatchTask, task.id])

  // ── Inline title edit ────────────────────────────────────────────────────

  const handleSaveTitle = useCallback(() => {
    const title = editTitleValue.trim()
    setEditingTitle(false)
    if (title && title !== task.title) {
      onPatchTask(task.id, { title })
    }
  }, [editTitleValue, task.id, task.title, onPatchTask])

  // ── Inline subtask add ────────────────────────────────────────────────────

  const handleAddSubtaskClick = useCallback(() => {
    if (!expanded) {
      pendingFocusAdd.current = true
      onToggleExpand(task.id)
    } else {
      newSubtaskRef.current?.focus()
    }
  }, [expanded, onToggleExpand, task.id])

  const handleSaveNewSubtask = useCallback(async () => {
    const title = newSubtaskTitle.trim()
    if (!title) return
    await onAddSubtask(task.id, title)
    setNewSubtaskTitle('')
    // keep focus for rapid multi-add
    newSubtaskRef.current?.focus()
  }, [onAddSubtask, task.id, newSubtaskTitle])

  // ── Inline subtask edit ───────────────────────────────────────────────────

  const handleStartEditSubtask = useCallback((sub) => {
    setEditingSubtaskId(sub.id)
    setEditSubtaskTitle(sub.title)
  }, [])

  const handleSaveEditSubtask = useCallback(async () => {
    if (!editingSubtaskId) return
    const title = editSubtaskTitle.trim()
    if (title) await onPatchSubtask(task.id, editingSubtaskId, { title })
    setEditingSubtaskId(null)
  }, [editingSubtaskId, editSubtaskTitle, onPatchSubtask, task.id])

  // ── Drag-and-drop reorder ─────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const handleDragEnd = useCallback(({ active, over }) => {
    if (!over || active.id === over.id) return
    const oldIndex = sortedSubtasks.findIndex(s => s.id === active.id)
    const newIndex = sortedSubtasks.findIndex(s => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorderSubtasks(task.id, arrayMove(sortedSubtasks, oldIndex, newIndex))
  }, [sortedSubtasks, onReorderSubtasks, task.id])

  // ── Days badge ────────────────────────────────────────────────────────────

  const daysBadge = getDaysBadge(task)

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
  const isDimmed    = task.status === 'done' || task.status === 'cancelled'

  return (
    <div
      className={`
        group relative border-l-4 ${stripeClass}
        bg-white dark:bg-slate-800/80
        border border-l-0 border-slate-200 dark:border-slate-700/60
        rounded-r-xl
        transition-all duration-200 ease-in-out
        hover:bg-slate-50 dark:hover:bg-slate-700/50
        hover:border-slate-300 dark:hover:border-slate-500/80
        hover:shadow-sm
        ${overdue ? 'bg-red-50/40 dark:bg-red-950/20' : ''}
        ${isDimmed ? 'opacity-55' : ''}
      `}
    >
      <div className="px-5 py-4">
        {/* Row 1: done-circle · title · status pill · overflow */}
        <div className="flex items-start gap-3.5">
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

          {editingTitle ? (
            <input
              autoFocus
              value={editTitleValue}
              onChange={e => setEditTitleValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveTitle()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              onBlur={handleSaveTitle}
              className="flex-1 min-w-0 text-base font-medium bg-transparent
                border-b-2 border-blue-500 dark:border-blue-400
                text-slate-800 dark:text-slate-100
                focus:outline-none pb-px"
            />
          ) : (
            <span
              onDoubleClick={() => {
                if (!isDimmed) {
                  setEditTitleValue(task.title)
                  setEditingTitle(true)
                }
              }}
              title={isDimmed ? undefined : 'Double-click to edit title'}
              className={`flex-1 min-w-0 text-base font-medium leading-snug select-none
                ${task.status === 'done'
                  ? 'line-through text-slate-400 dark:text-slate-500'
                  : 'text-slate-800 dark:text-slate-100'
                }`}
            >
              {task.title}
            </span>
          )}

          {task.status === 'todo' && editingField !== 'status' && (
            <button
              onClick={() => onPatchTask(task.id, { status: 'in_progress' })}
              title="Start task"
              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold
                bg-blue-600 text-white hover:bg-blue-500
                dark:bg-blue-600 dark:hover:bg-blue-500
                transition-colors shadow-sm"
            >
              ▶ Start
            </button>
          )}

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
              className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity hover:opacity-75 ${STATUS_PILL[task.status] ?? STATUS_PILL.todo}`}
            >
              <span>{STATUS_ICON[task.status]}</span>
              {STATUS_LABELS[task.status]}
            </button>
          )}

          <OverflowMenu items={menuItems} />
        </div>

        {/* Row 2: category badge + recurrence badge */}
        {(task.category || (task.recurrence && task.recurrence !== 'none')) && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5 ml-9">
            {task.category && (
              editingCategory ? (
                <select
                  autoFocus
                  defaultValue={task.category_id ?? ''}
                  onChange={e => {
                    onPatchTask(task.id, { category_id: e.target.value ? parseInt(e.target.value, 10) : null })
                    setEditingCategory(false)
                  }}
                  onBlur={() => setEditingCategory(false)}
                  onKeyDown={e => e.key === 'Escape' && setEditingCategory(false)}
                  className={`text-xs ${inlineCls}`}
                >
                  <option value="">No category</option>
                  {(categories ?? []).map(c => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
              ) : (
                <span
                  onDoubleClick={() => !isDimmed && setEditingCategory(true)}
                  title={isDimmed ? undefined : 'Double-click to change category'}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold cursor-default select-none"
                  style={{
                    background: withAlpha(task.category.color, 0.12),
                    color: task.category.color,
                    border: `1px solid ${withAlpha(task.category.color, 0.28)}`,
                  }}
                >
                  {task.category.icon} {task.category.name}
                </span>
              )
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

        {/* Row 4: subtask progress bar + expand toggle — or add-subtask nudge */}
        {subtaskCount > 0 ? (
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
        ) : !isDimmed && (
          <button
            onClick={handleAddSubtaskClick}
            className="mt-3 ml-9 flex items-center gap-1 text-xs text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
          >
            <span>+</span> Add subtask
          </button>
        )}
      </div>

      {/* Subtask completion confirmation modal */}
      {showSubtaskConfirm && (
        <SubtaskConfirmModal
          task={task}
          incompleteSubtasks={incompleteSubtasks}
          onCompleteAll={handleCompleteAllAndDone}
          onDoneAnyway={handleDoneAnyway}
          onCancel={() => setShowSubtaskConfirm(false)}
        />
      )}

      {/* Expanded: subtask list + inline add */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 pb-3 pt-2.5 ml-4">
          {task.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">{task.description}</p>
          )}

          {sortedSubtasks.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedSubtasks.map(s => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0.5 mb-2">
                  {sortedSubtasks.map(sub => (
                    <SortableSubtaskRow
                      key={sub.id}
                      sub={sub}
                      taskId={task.id}
                      isDimmed={isDimmed}
                      editingSubtaskId={editingSubtaskId}
                      editSubtaskTitle={editSubtaskTitle}
                      onStartEdit={handleStartEditSubtask}
                      onSaveEdit={handleSaveEditSubtask}
                      onCancelEdit={() => setEditingSubtaskId(null)}
                      onEditChange={setEditSubtaskTitle}
                      onPatchSubtask={onPatchSubtask}
                      onDeleteSubtask={onDeleteSubtask}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Inline add subtask */}
          {!isDimmed && (
            <div className="flex gap-2 mt-1">
              <input
                ref={newSubtaskRef}
                placeholder="Add subtask…"
                value={newSubtaskTitle}
                onChange={e => setNewSubtaskTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  handleSaveNewSubtask()
                  if (e.key === 'Escape') setNewSubtaskTitle('')
                }}
                className={subtaskInputCls}
              />
              <button
                onClick={handleSaveNewSubtask}
                disabled={!newSubtaskTitle.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold
                  bg-blue-600 text-white hover:bg-blue-500
                  disabled:opacity-30 disabled:cursor-not-allowed
                  transition-colors flex-shrink-0"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
