import React, { useCallback } from 'react'
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import TaskCard from './TaskCard'

// Per-section accent: [left-border color, label color light, label color dark, bg light, bg dark]
const SECTION_ACCENT = {
  overdue: {
    border:  'border-l-red-500',
    label:   'text-red-700 dark:text-red-400',
    bg:      'bg-red-50 dark:bg-red-950/30',
    hover:   'hover:bg-red-100/70 dark:hover:bg-red-950/50',
    badge:   'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
  },
  today: {
    border:  'border-l-amber-500',
    label:   'text-amber-700 dark:text-amber-400',
    bg:      'bg-amber-50 dark:bg-amber-950/20',
    hover:   'hover:bg-amber-100/70 dark:hover:bg-amber-950/40',
    badge:   'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
  },
  tomorrow: {
    border:  'border-l-amber-500',
    label:   'text-amber-700 dark:text-amber-400',
    bg:      'bg-amber-50 dark:bg-amber-950/20',
    hover:   'hover:bg-amber-100/70 dark:hover:bg-amber-950/40',
    badge:   'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
  },
  this_week: {
    border:  'border-l-blue-500',
    label:   'text-blue-700 dark:text-blue-400',
    bg:      'bg-blue-50 dark:bg-blue-950/20',
    hover:   'hover:bg-blue-100/70 dark:hover:bg-blue-950/40',
    badge:   'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400',
  },
  next_week: {
    border:  'border-l-violet-500',
    label:   'text-violet-700 dark:text-violet-400',
    bg:      'bg-violet-50 dark:bg-violet-950/20',
    hover:   'hover:bg-violet-100/70 dark:hover:bg-violet-950/40',
    badge:   'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400',
  },
  later: {
    border:  'border-l-slate-400',
    label:   'text-slate-600 dark:text-slate-300',
    bg:      'bg-slate-100 dark:bg-slate-800/50',
    hover:   'hover:bg-slate-200/70 dark:hover:bg-slate-800/80',
    badge:   'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  },
  done: {
    border:  'border-l-emerald-500',
    label:   'text-emerald-700 dark:text-emerald-400',
    bg:      'bg-emerald-50 dark:bg-emerald-950/20',
    hover:   'hover:bg-emerald-100/70 dark:hover:bg-emerald-950/40',
    badge:   'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400',
  },
  no_date: {
    border:  'border-l-slate-400',
    label:   'text-slate-500 dark:text-slate-400',
    bg:      'bg-slate-100 dark:bg-slate-800/40',
    hover:   'hover:bg-slate-200/70 dark:hover:bg-slate-800/70',
    badge:   'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  },
}

const SECTION_ICON = {
  overdue:   '🔥',
  today:     '☀️',
  tomorrow:  '📅',
  this_week:     '📆',
  next_week:     '🗓',
  later:         '⏳',
  done:          '✅',
  no_date:       '📌',
}

function SortableTaskWrapper({ task, dismissing, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: dismissing,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="relative group/task-row"
    >
      <button
        {...attributes}
        {...listeners}
        tabIndex={-1}
        title="Drag to reorder"
        className="absolute left-0 top-0 bottom-0 z-10
          flex items-center px-1
          opacity-0 group-hover/task-row:opacity-100
          cursor-grab active:cursor-grabbing
          text-slate-300 dark:text-slate-600
          hover:text-slate-500 dark:hover:text-slate-400
          transition-opacity select-none text-xs
          -translate-x-3"
      >
        ⠿
      </button>
      {children}
    </div>
  )
}

export default function TaskSection({
  sectionKey,
  label,
  tasks,
  collapsed,
  onToggleCollapse,
  expandedCards,
  onToggleExpand,
  onEdit,
  onPatchTask,
  onDeleteTask,
  onPatchSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onReorderSubtasks,
  onReorderTasks,
  persons,
  categories,
  dismissingIds = new Set(),
}) {
  const count = tasks.length
  const accent = SECTION_ACCENT[sectionKey] ?? SECTION_ACCENT.later
  const icon   = SECTION_ICON[sectionKey] ?? '•'

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const handleDragEnd = useCallback(({ active, over }) => {
    if (!over || active.id === over.id) return
    const oldIndex = tasks.findIndex(t => t.id === active.id)
    const newIndex = tasks.findIndex(t => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorderTasks(arrayMove(tasks, oldIndex, newIndex))
  }, [tasks, onReorderTasks])

  return (
    <div className="mb-3">
      {/* Section header */}
      <button
        onClick={onToggleCollapse}
        className={`
          w-full flex items-center gap-3 px-4 py-3
          border-l-4 ${accent.border}
          ${accent.bg} ${accent.hover}
          border border-l-4 border-slate-200 dark:border-slate-700/50
          transition-colors select-none group
        `}
        style={{ borderRadius: collapsed ? '12px' : '12px 12px 0 0' }}
      >
        <span className="text-base leading-none">{icon}</span>

        <span className={`font-bold text-base tracking-tight ${accent.label}`}>
          {label}
        </span>

        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${accent.badge}`}>
          {count}
        </span>

        <div className="flex-1" />

        {sectionKey === 'overdue' && count > 0 && (
          <span className="text-xs font-semibold text-red-500 dark:text-red-400 mr-1">
            Needs attention
          </span>
        )}

        <span className={`text-sm transition-transform duration-200 ${accent.label} opacity-60`}>
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      {/* Cards */}
      {!collapsed && count > 0 && (
        <div className="border border-t-0 border-slate-200 dark:border-slate-700/50 rounded-b-xl
          bg-slate-50/50 dark:bg-slate-900/30 p-3 space-y-2.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tasks.map(t => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {tasks.map(task => {
                const dismissing = dismissingIds.has(task.id)
                return (
                  <SortableTaskWrapper key={task.id} task={task} dismissing={dismissing}>
                    <div
                      className="transition-all duration-300 ease-out overflow-hidden"
                      style={{ maxHeight: dismissing ? '0' : '2000px', marginBottom: dismissing ? '0' : undefined }}
                    >
                      <TaskCard
                        task={task}
                        expanded={!!expandedCards[task.id]}
                        onToggleExpand={onToggleExpand}
                        onEdit={onEdit}
                        onPatchTask={onPatchTask}
                        onDeleteTask={onDeleteTask}
                        onPatchSubtask={onPatchSubtask}
                        onAddSubtask={onAddSubtask}
                        onDeleteSubtask={onDeleteSubtask}
                        onReorderSubtasks={onReorderSubtasks}
                        persons={persons}
                        categories={categories}
                        dismissing={dismissing}
                      />
                    </div>
                  </SortableTaskWrapper>
                )
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Empty state */}
      {!collapsed && count === 0 && (
        <div className="border border-t-0 border-slate-200 dark:border-slate-700/50 rounded-b-xl
          bg-slate-50/50 dark:bg-slate-900/30 px-4 py-6 text-center
          text-sm text-slate-400 dark:text-slate-500 italic">
          No tasks
        </div>
      )}
    </div>
  )
}
