'use client'
import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import type { Task } from './helpers'

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-500',
  low:    'bg-slate-400',
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + n)
  return result
}

function dateToStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isLocked(task: Task): boolean {
  return task.priority === 'high' || (task.recurrence != null && task.recurrence !== 'none')
}

function isTerminal(task: Task): boolean {
  return task.status === 'done' || task.status === 'cancelled' || task.status === 'ontime'
}

function dayCapacity(date: Date, monThu: number, fri: number, weekend: number): number {
  const day = date.getDay()
  if (day === 0 || day === 6) return weekend
  if (day === 5) return fri
  return monThu
}

function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6)
  const startStr = weekStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const endStr = weekEnd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${startStr} – ${endStr}`
}

// ── Drag preview (rendered in DragOverlay — no useDraggable) ──────────────────

function DragPreviewCard({ task }: { task: Task }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs
      bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200
      border border-slate-200 dark:border-slate-700/60
      shadow-lg rotate-1 opacity-95 pointer-events-none">
      <GripVertical size={10} className="flex-shrink-0 text-slate-400" />
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-slate-400'}`} />
      <span className="truncate leading-tight max-w-[140px]">{task.title}</span>
    </div>
  )
}

// ── Task card (inside columns) ─────────────────────────────────────────────────

interface PlannerTaskCardProps {
  task: Task
}

function PlannerTaskCard({ task }: PlannerTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(task.id),
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-opacity
        border border-slate-200 dark:border-slate-700/60
        bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80
        ${isDragging ? 'opacity-30' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        aria-label="Drag handle"
      >
        <GripVertical size={10} />
      </div>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-slate-400'}`} />
      <span className="flex-1 truncate leading-tight">{task.title}</span>
    </div>
  )
}

// ── Droppable day column ───────────────────────────────────────────────────────

interface DroppableColumnProps {
  columnId: string
  label: string
  date?: Date
  tasks: Task[]
  capacity?: number
  isToday?: boolean
  hasActiveItem: boolean
  children: React.ReactNode
}

function DroppableColumn({
  columnId, label, date: _date, tasks, capacity, isToday = false, hasActiveItem, children,
}: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId })

  const count = tasks.length
  const fillPct = capacity ? Math.min((count / capacity) * 100, 100) : 0
  const barColor = capacity
    ? count > capacity ? 'bg-red-500' : fillPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
    : 'bg-slate-300'

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[180px] w-[180px] rounded-xl border flex-shrink-0 transition-colors
        ${isOver
          ? 'border-blue-400 bg-blue-50/60 dark:bg-blue-500/10 dark:border-blue-500/60'
          : 'border-slate-200 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30'
        }`}
    >
      <div className={`px-2.5 pt-2.5 pb-2 border-b border-slate-200 dark:border-slate-700/60 rounded-t-xl
        ${isToday ? 'bg-orange-50 dark:bg-orange-950/30' : ''}`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className={`text-xs font-semibold
            ${isToday ? 'text-orange-600 dark:text-orange-400' : 'text-slate-600 dark:text-slate-300'}`}>
            {label}
          </span>
          {capacity !== undefined && (
            <span className={`text-[10px] font-medium tabular-nums
              ${count > capacity ? 'text-red-500' : count >= capacity * 0.8 ? 'text-amber-500' : 'text-slate-400'}`}>
              {count}/{capacity}
            </span>
          )}
        </div>
        {capacity !== undefined && (
          <div className="h-1 w-full rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={`h-1 rounded-full transition-all ${barColor}`}
              style={{ width: `${fillPct}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[80px]">
        {children}
        {count === 0 && !hasActiveItem && (
          <div className="flex items-center justify-center h-10 text-[10px] text-slate-300 dark:text-slate-600 select-none">
            Drop here
          </div>
        )}
      </div>
    </div>
  )
}

// ── Readonly (Overdue) column — not a drop target ──────────────────────────────

interface ReadonlyColumnProps {
  label: string
  count: number
  children: React.ReactNode
}

function ReadonlyColumn({ label, count, children }: ReadonlyColumnProps) {
  return (
    <div className="flex flex-col min-w-[180px] w-[180px] rounded-xl border flex-shrink-0
      border-red-200 dark:border-red-900/40 bg-red-50/30 dark:bg-red-950/10">
      <div className="px-2.5 pt-2.5 pb-2 border-b border-red-200 dark:border-red-900/40 rounded-t-xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">{label}</span>
          <span className="text-[10px] text-red-400 dark:text-red-500 tabular-nums">{count}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[80px]">
        {children}
        {count === 0 && (
          <div className="flex items-center justify-center h-10 text-[10px] text-slate-300 dark:text-slate-600 select-none">
            No overdue tasks
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export interface TaskRebalancerModalProps {
  open: boolean
  onClose: () => void
  tasks: Task[]
  onApply: (moves: Array<{ id: number; due_date: string | null }>) => Promise<void>
  capacityMonThu: number
  capacityFri: number
  capacityWeekend: number
}

export default function TaskRebalancerModal({
  open,
  onClose,
  tasks,
  onApply,
  capacityMonThu,
  capacityFri,
  capacityWeekend,
}: TaskRebalancerModalProps) {
  const [weekStart, setWeekStart] = useState<Date>(today)
  const [pendingMoves, setPendingMoves] = useState<Record<number, string | null>>({})
  const [applying, setApplying] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Reset to today on open; leave pendingMoves in place until Cancel/Apply.
  useEffect(() => {
    if (open) setWeekStart(today())
  }, [open])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const weekDayStrs = useMemo(() => weekDays.map(dateToStr), [weekDays])
  const todayStr = dateToStr(new Date())

  const getEffectiveDateStr = useCallback((task: Task): string | null => {
    if (Object.prototype.hasOwnProperty.call(pendingMoves, task.id)) return pendingMoves[task.id]
    return task.due_date ?? null
  }, [pendingMoves])

  const activeTasks = useMemo(() => tasks.filter(t => !isTerminal(t)), [tasks])

  const grouped = useMemo(() => {
    const result: Record<string, Task[]> = { overdue: [] }
    for (const ds of weekDayStrs) result[ds] = []

    for (const task of activeTasks) {
      const d = getEffectiveDateStr(task)
      if (!d) {
        // tasks with no due_date are not shown in the week grid
      } else if (weekDayStrs.includes(d)) {
        result[d].push(task)
      } else if (d < weekDayStrs[0]) {
        result.overdue.push(task)
      }
      // tasks beyond this week are visible when navigating to that week
    }
    return result
  }, [activeTasks, weekDayStrs, getEffectiveDateStr])

  const prevWeek = useCallback(() => setWeekStart(ws => addDays(ws, -7)), [])
  const nextWeek = useCallback(() => setWeekStart(ws => addDays(ws, 7)), [])

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const taskId = Number(active.id)
    const targetColumn = String(over.id)
    // Overdue is read-only — no drops accepted
    if (targetColumn === 'overdue') return

    const newDueDate = targetColumn

    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    if (getEffectiveDateStr(task) === newDueDate) return

    setPendingMoves(prev => ({ ...prev, [taskId]: newDueDate }))
  }

  function runAutoSuggest() {
    // Build a mutable copy of the current week schedule
    const schedule: Record<string, Task[]> = {}
    for (const ds of weekDayStrs) schedule[ds] = [...(grouped[ds] ?? [])]

    const newMoves: Record<number, string | null> = { ...pendingMoves }
    const priorityRank: Record<string, number> = { medium: 0, low: 1 }

    for (const dayStr of weekDayStrs) {
      const dayDate = new Date(dayStr + 'T00:00:00')
      const cap = dayCapacity(dayDate, capacityMonThu, capacityFri, capacityWeekend)
      if (schedule[dayStr].length <= cap) continue

      const soft = schedule[dayStr]
        .filter(t => !isLocked(t))
        .sort((a, b) => (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2))

      const surplus = schedule[dayStr].length - cap
      const toMove = soft.slice(0, surplus)

      for (const task of toMove) {
        let bestDay: string | null = null
        let bestRemaining = 0

        for (const targetStr of weekDayStrs) {
          if (targetStr === dayStr) continue
          const targetDate = new Date(targetStr + 'T00:00:00')
          const targetCap = dayCapacity(targetDate, capacityMonThu, capacityFri, capacityWeekend)
          const remaining = targetCap - schedule[targetStr].length
          if (remaining > bestRemaining) {
            bestRemaining = remaining
            bestDay = targetStr
          }
        }

        if (bestDay) {
          newMoves[task.id] = bestDay
          schedule[dayStr] = schedule[dayStr].filter(t => t.id !== task.id)
          schedule[bestDay] = [...schedule[bestDay], task]
        }
      }
    }

    setPendingMoves(newMoves)
  }

  const pendingCount = useMemo(() =>
    Object.entries(pendingMoves).filter(([taskId, newDate]) => {
      const task = tasks.find(t => t.id === Number(taskId))
      return task != null && (task.due_date ?? null) !== newDate
    }).length,
  [pendingMoves, tasks])

  async function handleApply() {
    setApplying(true)
    const moves = Object.entries(pendingMoves)
      .filter(([taskId, newDate]) => {
        const task = tasks.find(t => t.id === Number(taskId))
        return task != null && (task.due_date ?? null) !== newDate
      })
      .map(([taskId, newDate]) => ({ id: Number(taskId), due_date: newDate }))

    try {
      await onApply(moves)
      setPendingMoves({})
      onClose()
    } finally {
      setApplying(false)
    }
  }

  function handleCancel() {
    setPendingMoves({})
    onClose()
  }

  const activeTask = activeId ? (tasks.find(t => String(t.id) === activeId) ?? null) : null

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        onClick={handleCancel}
        aria-hidden
      />

      <div className="relative z-10 flex flex-col w-full max-w-[98vw] h-[92vh]
        bg-white dark:bg-slate-900
        rounded-2xl shadow-2xl
        border border-slate-200 dark:border-slate-700/60">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-slate-700/60 flex-shrink-0 flex-wrap">
          <span className="text-base font-semibold text-slate-800 dark:text-slate-100">
            Task Planner
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={prevWeek}
              aria-label="Previous week"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-lg
                text-slate-500 dark:text-slate-400
                hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              ‹
            </button>
            <span className="text-sm text-slate-600 dark:text-slate-300 font-medium min-w-[210px] text-center select-none">
              {formatWeekRange(weekStart)}
            </span>
            <button
              onClick={nextWeek}
              aria-label="Next week"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-lg
                text-slate-500 dark:text-slate-400
                hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              ›
            </button>
          </div>

          <div className="flex-1" />

          <button
            onClick={runAutoSuggest}
            title="Redistribute overloaded days automatically"
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300
              hover:bg-violet-200 dark:hover:bg-violet-500/30
              border border-violet-200 dark:border-violet-500/30"
          >
            Auto-suggest
          </button>

          <button
            onClick={handleApply}
            disabled={applying || pendingCount === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all
              bg-blue-600 hover:bg-blue-500 text-white
              disabled:opacity-40 disabled:cursor-not-allowed
              shadow-sm shadow-blue-500/20"
          >
            {applying ? 'Saving…' : pendingCount > 0 ? `Apply (${pendingCount})` : 'Apply'}
          </button>

          <button
            onClick={handleCancel}
            className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all
              bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300
              hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
        </div>

        {/* ── Grid ── */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
            <div className="flex gap-3 h-full min-w-max">

              {/* Overdue (read-only — source only, not a drop target) */}
              <ReadonlyColumn label="Overdue" count={grouped.overdue.length}>
                {grouped.overdue.map(task => (
                  <PlannerTaskCard key={task.id} task={task} />
                ))}
              </ReadonlyColumn>

              {/* One column per day */}
              {weekDays.map((day, i) => {
                const ds = weekDayStrs[i]
                const dayTasks = grouped[ds] ?? []
                const cap = dayCapacity(day, capacityMonThu, capacityFri, capacityWeekend)
                const month = day.getMonth() + 1
                const dayNum = day.getDate()
                const isToday = ds === todayStr

                return (
                  <DroppableColumn
                    key={ds}
                    columnId={ds}
                    label={`${day.toLocaleDateString('en-US', { weekday: 'short' })} ${month}/${dayNum}`}
                    date={day}
                    tasks={dayTasks}
                    capacity={cap}
                    isToday={isToday}
                    hasActiveItem={!!activeId}
                  >
                    {dayTasks.map(task => (
                      <PlannerTaskCard key={task.id} task={task} />
                    ))}
                  </DroppableColumn>
                )
              })}

            </div>
          </div>

          <DragOverlay>
            {activeTask ? <DragPreviewCard task={activeTask} /> : null}
          </DragOverlay>
        </DndContext>

        {/* ── Footer legend ── */}
        <div className="flex items-center gap-4 px-5 py-2.5 border-t border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500 ml-auto">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Under capacity</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Near capacity</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Over capacity</span>
          </div>
        </div>
      </div>
    </div>
  )
}
