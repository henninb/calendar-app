import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  isOverdue, fmt, withAlpha, parseMinutes,
  STATUS_LABELS, STATUS_OPTIONS, getDaysBadge,
} from './helpers'

const FIELDS = {
  STATUS:            'status',
  DUE_DATE:          'due_date',
  ASSIGNEE_ID:       'assignee_id',
  ESTIMATED_MINUTES: 'estimated_minutes',
  CATEGORY:          'category_id',
}

const MOUSE_ACTIVATION = { activationConstraint: { distance: 5 } }
const TOUCH_ACTIVATION = { activationConstraint: { delay: 200, tolerance: 5 } }

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

// ── InlineMetaField ───────────────────────────────────────────────────────────
// Renders a clickable icon+label button in view mode and an icon+control in
// edit mode.  `extra` is optional trailing content shown only in view mode
// (e.g. a days-remaining badge).

function InlineMetaField({ icon, label, title, editing, onStartEdit, extra, children, ghost }) {
  if (editing) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="opacity-60">{icon}</span>
        {children}
      </span>
    )
  }
  if (!onStartEdit) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="opacity-60">{icon}</span>
        <span>{label}</span>
        {extra}
      </span>
    )
  }
  return (
    <button
      onClick={onStartEdit}
      title={title}
      className="group flex items-center gap-1.5 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
    >
      <span className={ghost ? 'opacity-30' : 'opacity-60'}>{icon}</span>
      <span className={`border-b border-dashed border-transparent group-hover:border-blue-400 transition-colors${ghost ? ' text-slate-300 dark:text-slate-600 italic' : ''}`}>
        {label}
      </span>
      {extra}
    </button>
  )
}

// ── OverflowMenu ──────────────────────────────────────────────────────────────

function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const visible = items.filter(item => !item.hidden)
  if (visible.length === 0) return null

  function handleOpen(e) {
    e.stopPropagation()
    if (!open) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + window.scrollY + 4, right: window.innerWidth - rect.right })
    }
    setOpen(o => !o)
  }

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={btnRef}
        onClick={handleOpen}
        title="More actions"
        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-lg leading-none"
      >
        ···
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'absolute', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden py-1"
        >
          {visible.map(item => (
            <button
              key={item.label}
              role="menuitem"
              onClick={e => { e.stopPropagation(); item.onClick(); setOpen(false) }}
              className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm transition-colors
                ${item.danger
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
              <span aria-hidden="true" className="w-4 text-center opacity-70">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── SubtaskConfirmModal ───────────────────────────────────────────────────────

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

// ── SortableSubtaskRow ────────────────────────────────────────────────────────

function SortableSubtaskRow({
  sub, taskId, isDimmed,
  subtaskDraft,       // { id, title } | null
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

  const isEditing = subtaskDraft?.id === sub.id

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
            value={subtaskDraft.title}
            onChange={e => onEditChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            onBlur={onSaveEdit}
            className={subtaskInputCls}
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

// ── TaskCard ──────────────────────────────────────────────────────────────────

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
  dismissing = false,
}) {
  const [editingField, setEditingField] = useState(null)
  const [showSubtaskConfirm, setShowSubtaskConfirm] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)

  // null = not editing; string value = editing with that draft
  const [titleDraft, setTitleDraft] = useState(null)

  // null = not editing; { id, title } = editing that subtask
  const [subtaskDraft, setSubtaskDraft] = useState(null)

  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const newSubtaskRef   = useRef(null)
  const pendingFocusAdd = useRef(false)

  // After expand triggered by clicking "+ Add subtask", focus the add input
  useEffect(() => {
    if (expanded && pendingFocusAdd.current) {
      pendingFocusAdd.current = false
      setTimeout(() => newSubtaskRef.current?.focus(), 30)
    }
  }, [expanded])

  useEffect(() => {
    if (!pendingDelete) return
    function handle(e) { if (e.key === 'Escape') setPendingDelete(false) }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [pendingDelete])

  // ── Derived task values ───────────────────────────────────────────────────

  const overdue = isOverdue(task)
  const isDimmed = task.status === 'done' || task.status === 'cancelled'

  const subtaskCount = useMemo(() => task.subtasks?.length ?? 0, [task.subtasks])
  const doneSubtasks = useMemo(
    () => task.subtasks?.filter(s => s.status === 'done').length ?? 0,
    [task.subtasks],
  )
  const incompleteSubtasks = useMemo(
    () => task.subtasks?.filter(s => s.status !== 'done' && s.status !== 'cancelled') ?? [],
    [task.subtasks],
  )
  const sortedSubtasks = useMemo(
    () => [...(task.subtasks ?? [])].sort((a, b) => a.order - b.order),
    [task.subtasks],
  )

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
    await Promise.all(
      incompleteSubtasks.map(sub => onPatchSubtask(task.id, sub.id, { status: 'done' }))
    )
    onPatchTask(task.id, { status: 'done' })
  }, [onPatchSubtask, onPatchTask, task.id, incompleteSubtasks])

  const handleDoneAnyway = useCallback(() => {
    setShowSubtaskConfirm(false)
    onPatchTask(task.id, { status: 'done' })
  }, [onPatchTask, task.id])

  // ── Inline title edit ─────────────────────────────────────────────────────

  const handleSaveTitle = useCallback(() => {
    const title = titleDraft?.trim()
    setTitleDraft(null)
    if (title && title !== task.title) {
      onPatchTask(task.id, { title })
    }
  }, [titleDraft, task.id, task.title, onPatchTask])

  // ── Inline subtask add ────────────────────────────────────────────────────

  const handleAddSubtaskClick = useCallback(() => {
    if (!expanded) {
      pendingFocusAdd.current = true
    }
    onToggleExpand(task.id)
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
    setSubtaskDraft({ id: sub.id, title: sub.title })
  }, [])

  const handleSaveEditSubtask = useCallback(async () => {
    if (!subtaskDraft) return
    const title = subtaskDraft.title.trim()
    if (title) await onPatchSubtask(task.id, subtaskDraft.id, { title })
    setSubtaskDraft(null)
  }, [subtaskDraft, onPatchSubtask, task.id])

  const handleCancelEditSubtask = useCallback(() => setSubtaskDraft(null), [])

  const handleEditSubtaskChange = useCallback((title) => {
    setSubtaskDraft(prev => prev ? { ...prev, title } : prev)
  }, [])

  // ── Drag-and-drop reorder ─────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_ACTIVATION),
    useSensor(TouchSensor, TOUCH_ACTIVATION),
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

  const menuItems = useMemo(() => [
    {
      label: 'Edit',
      icon: '✎',
      onClick: () => onEdit(task),
    },
    {
      label: 'Copy',
      icon: '⎘',
      onClick: () => navigator.clipboard.writeText(task.title),
    },
    {
      label: 'Start',
      icon: '▶',
      hidden: task.status !== 'todo',
      onClick: () => onPatchTask(task.id, { status: 'in_progress' }),
    },
    {
      label: 'Complete',
      icon: '✓',
      hidden: task.status === 'done' || task.status === 'cancelled',
      onClick: handleDone,
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
      onClick: () => setPendingDelete(true),
    },
  ], [task, onEdit, onPatchTask, onDeleteTask, handleDone])

  const stripeClass = PRIORITY_STRIPE[task.priority] ?? PRIORITY_STRIPE.low

  return (
    <div
      className={`
        group relative border-l-4 ${stripeClass}
        bg-white dark:bg-slate-800/80
        border border-l-0 border-slate-200 dark:border-slate-700/60
        rounded-r-xl
        transition-all duration-300 ease-out
        hover:bg-slate-50 dark:hover:bg-slate-700/50
        hover:border-slate-300 dark:hover:border-slate-500/80
        hover:shadow-sm
        ${overdue ? 'bg-red-50/40 dark:bg-red-950/20' : ''}
        ${isDimmed ? 'opacity-55' : ''}
        ${dismissing ? 'opacity-0 scale-x-[0.98] -translate-y-1 pointer-events-none' : ''}
      `}
    >
      <div className="px-5 py-4">
        {/* Row 1: done-circle · title · status pill · overflow */}
        <div className="flex items-start gap-3.5">
          <div className="mt-0.5 flex-shrink-0 flex items-center gap-1.5">
            {task.status !== 'done' && task.status !== 'cancelled' ? (
              <button
                onClick={handleDone}
                title="Mark as done"
                className="w-5 h-5 flex items-center justify-center rounded-full border-2 border-slate-300 dark:border-slate-600 hover:border-emerald-500 dark:hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-slate-300 dark:text-slate-600 hover:text-emerald-500 dark:hover:text-emerald-400 text-[10px] transition-all"
              >
                ✓
              </button>
            ) : (
              <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 border-2 border-emerald-400 dark:border-emerald-500/60 flex items-center justify-center">
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px] leading-none font-bold">✓</span>
              </div>
            )}
            {task.status === 'todo' && (
              <button
                onClick={() => onPatchTask(task.id, { status: 'in_progress' })}
                title="Start task"
                className="w-5 h-5 flex items-center justify-center rounded-full border-2 border-slate-300 dark:border-slate-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 text-[9px] transition-all"
              >
                ▶
              </button>
            )}
          </div>

          {titleDraft !== null ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveTitle()
                if (e.key === 'Escape') setTitleDraft(null)
              }}
              onBlur={handleSaveTitle}
              className="flex-1 min-w-0 text-base font-medium bg-transparent
                border-b-2 border-blue-500 dark:border-blue-400
                text-slate-800 dark:text-slate-100
                focus:outline-none pb-px"
            />
          ) : (
            <>
              <span
                onDoubleClick={() => {
                  if (!isDimmed) setTitleDraft(task.title)
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
              {!isDimmed && (
                <button
                  onClick={() => setTitleDraft(task.title)}
                  title="Edit title"
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all text-xs"
                >✎</button>
              )}
            </>
          )}

          {editingField === FIELDS.STATUS ? (
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
              onClick={() => setEditingField(FIELDS.STATUS)}
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
              editingField === FIELDS.CATEGORY ? (
                <select
                  autoFocus
                  defaultValue={task.category_id ?? ''}
                  onChange={e => {
                    onPatchTask(task.id, { category_id: e.target.value ? parseInt(e.target.value, 10) : null })
                    setEditingField(null)
                  }}
                  onBlur={() => setEditingField(null)}
                  onKeyDown={e => e.key === 'Escape' && setEditingField(null)}
                  className={`text-xs ${inlineCls}`}
                >
                  <option value="">No category</option>
                  {(categories ?? []).map(c => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
              ) : (
                <span
                  onDoubleClick={() => !isDimmed && setEditingField(FIELDS.CATEGORY)}
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

        {/* Row 3: metadata (date · assignee · est. time) — always shown for active tasks */}
        {(!isDimmed || task.due_date || task.assignee || task.estimated_minutes) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2.5 ml-9 text-sm text-slate-500 dark:text-slate-400">
            {(!isDimmed || task.due_date) && (
              <InlineMetaField
                icon="📅"
                label={task.due_date ? fmt(task.due_date) : 'Add date'}
                title="Click to set due date"
                editing={editingField === FIELDS.DUE_DATE}
                onStartEdit={!isDimmed ? () => setEditingField(FIELDS.DUE_DATE) : undefined}
                ghost={!task.due_date}
                extra={daysBadge && (
                  <span className={daysBadge.cls}>· {daysBadge.text}</span>
                )}
              >
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
                    if (e.key === 'Enter') {
                      onPatchTask(task.id, { due_date: e.target.value || null })
                      setEditingField(null)
                    }
                    if (e.key === 'Escape') setEditingField(null)
                  }}
                  className={inlineCls}
                />
              </InlineMetaField>
            )}

            <InlineMetaField
              icon="👤"
              label={task.assignee?.name ?? 'Unassigned'}
              title="Click to edit assignee"
              editing={editingField === FIELDS.ASSIGNEE_ID}
              onStartEdit={!isDimmed ? () => setEditingField(FIELDS.ASSIGNEE_ID) : undefined}
              ghost={!task.assignee}
            >
              <select
                autoFocus
                defaultValue={task.assignee_id ?? ''}
                onChange={e => {
                  onPatchTask(task.id, { assignee_id: e.target.value || null })
                  setEditingField(null)
                }}
                onBlur={() => setEditingField(null)}
                onKeyDown={e => e.key === 'Escape' && setEditingField(null)}
                className={inlineCls}
              >
                <option value="">Unassigned</option>
                {(persons ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </InlineMetaField>

            <InlineMetaField
              icon="⏱"
              label={task.estimated_minutes ? `${task.estimated_minutes}m` : 'Add duration'}
              title="Click to edit duration"
              editing={editingField === FIELDS.ESTIMATED_MINUTES}
              onStartEdit={!isDimmed ? () => setEditingField(FIELDS.ESTIMATED_MINUTES) : undefined}
              ghost={!task.estimated_minutes}
            >
              <input
                type="number"
                autoFocus
                min="1"
                defaultValue={task.estimated_minutes ?? ''}
                placeholder="min"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onPatchTask(task.id, { estimated_minutes: parseMinutes(e.target.value) })
                    setEditingField(null)
                  }
                  if (e.key === 'Escape') setEditingField(null)
                }}
                onBlur={e => {
                  onPatchTask(task.id, { estimated_minutes: parseMinutes(e.target.value) })
                  setEditingField(null)
                }}
                className={`w-20 ${inlineCls}`}
              />
            </InlineMetaField>
          </div>
        )}

        {/* Row 4: subtask progress bar + expand toggle — or add-subtask nudge */}
        {subtaskCount > 0 ? (
          <button
            onClick={() => onToggleExpand(task.id)}
            className="w-full flex items-center gap-2.5 mt-3.5 pl-9 group/subtask-row cursor-pointer"
          >
            <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${(doneSubtasks / subtaskCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0 tabular-nums">
              {doneSubtasks}/{subtaskCount}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500 group-hover/subtask-row:text-slate-700 dark:group-hover/subtask-row:text-slate-300 transition-colors flex-shrink-0">
              {expanded ? '▾ hide' : '▸ subtasks'}
            </span>
          </button>
        ) : !isDimmed && (
          <button
            onClick={handleAddSubtaskClick}
            className="mt-3 w-full pl-9 flex items-center gap-1 text-xs text-left text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors opacity-40 group-hover:opacity-100"
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

      {/* Inline delete confirmation */}
      {pendingDelete && (
        <div className="flex items-center justify-between gap-3 px-5 py-3
          bg-red-50 dark:bg-red-950/30
          border-t border-red-100 dark:border-red-900/50">
          <span className="text-sm text-red-700 dark:text-red-400 font-medium">
            Delete this task?
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => { onDeleteTask(task.id); setPendingDelete(false) }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setPendingDelete(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold
                bg-slate-200 dark:bg-slate-700
                text-slate-600 dark:text-slate-300
                hover:bg-slate-300 dark:hover:bg-slate-600
                transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
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
                      subtaskDraft={subtaskDraft}
                      onStartEdit={handleStartEditSubtask}
                      onSaveEdit={handleSaveEditSubtask}
                      onCancelEdit={handleCancelEditSubtask}
                      onEditChange={handleEditSubtaskChange}
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
                  if (e.key === 'Enter') handleSaveNewSubtask()
                  if (e.key === 'Escape') {
                    setNewSubtaskTitle('')
                    onToggleExpand(task.id)
                  }
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
