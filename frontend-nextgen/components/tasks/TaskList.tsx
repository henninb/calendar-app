'use client'
import {
  useState, useEffect, useCallback, useMemo, useRef, useReducer,
} from 'react'
import {
  fetchTasks, fetchPersons, fetchCategories,
  createTask, updateTask, deleteTask,
  createSubtask, updateSubtask, deleteSubtask,
} from '@/lib/api'
import {
  SECTION_DEFS, TASK_FETCH_LIMIT, STATUS_OPTIONS, localDate,
  undoDescription, reversePayload,
} from './helpers'
import type { Task, Subtask, Person, Category, TaskStatus } from './helpers'
import TaskToolbar from './TaskToolbar'
import TaskSection from './TaskSection'
import TaskPanel from './TaskPanel'
import UndoToast from './UndoToast'
import { useUndoStack } from './useUndoStack'

interface PanelState {
  open: boolean
  mode: 'create' | 'edit'
  task: Task | null
}

export default function TaskList() {
  const [tasks, setTasks]                   = useState<Task[]>([])
  const [persons, setPersons]               = useState<Person[]>([])
  const [categories, setCategories]         = useState<Category[]>([])
  const [filterStatus, setFilterStatus]     = useState<TaskStatus[]>(['todo', 'in_progress'])
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [searchQuery, setSearchQuery]       = useState('')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [expandedCards, setExpandedCards]   = useState<Record<number, boolean>>({})
  const [panel, setPanel]                   = useState<PanelState>({ open: false, mode: 'create', task: null })
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)
  const [dismissingIds, setDismissingIds]   = useState<Set<number>>(new Set())

  const tasksRef = useRef<Task[]>(tasks)
  tasksRef.current = tasks

  const { push: pushUndo, undo, canUndo, lastAction, dismissToast } = useUndoStack()

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [undo])

  const [, tick] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const abortRef = useRef<AbortController | null>(null)

  const silentLoad = useCallback(async () => {
    try {
      const [t, p, c] = await Promise.all([fetchTasks({}), fetchPersons(), fetchCategories()])
      if (t.length >= TASK_FETCH_LIMIT) {
        console.warn(`[TaskList] hit fetch limit (${TASK_FETCH_LIMIT})`)
      }
      setTasks(t)
      setPersons(p)
      setCategories(c)
    } catch (err) {
      console.error('[TaskList] silentLoad failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    setLoading(true)
    setError(null)
    try {
      const [t, p, c] = await Promise.all([
        fetchTasks({}, signal),
        fetchPersons(signal),
        fetchCategories(signal),
      ])
      if (t.length >= TASK_FETCH_LIMIT) {
        console.warn(`[TaskList] hit fetch limit (${TASK_FETCH_LIMIT})`)
      }
      setTasks(t)
      setPersons(p)
      setCategories(c)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[TaskList] load failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const today    = localDate(0)
  const tomorrow = localDate(1)
  const week1end = localDate(7)
  const week2end = localDate(14)

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return tasks
      .filter(t => {
        if (filterStatus.length && !filterStatus.includes(t.status)) return false
        if (filterAssignee === 'unassigned') { if (t.assignee_id != null) return false }
        else if (filterAssignee && String(t.assignee_id) !== filterAssignee) return false
        if (filterCategory && String(t.category_id) !== filterCategory) return false
        if (q && !t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
      })
  }, [tasks, filterStatus, filterAssignee, filterCategory, searchQuery])

  const grouped = useMemo(() => {
    const result: Record<string, Task[]> = {
      done: [], overdue: [], today: [], tomorrow: [],
      this_week: [], next_week: [], later: [], no_date: [],
    }
    for (const task of visible) {
      if (task.status === 'done') {
        result.done.push(task)
      } else if (!task.due_date) {
        result.no_date.push(task)
      } else if (task.due_date < today) {
        result.overdue.push(task)
      } else if (task.due_date === today) {
        result.today.push(task)
      } else if (task.due_date === tomorrow) {
        result.tomorrow.push(task)
      } else if (task.due_date <= week1end) {
        result.this_week.push(task)
      } else if (task.due_date <= week2end) {
        result.next_week.push(task)
      } else {
        result.later.push(task)
      }
    }
    for (const key of Object.keys(result)) {
      result[key].sort((a, b) =>
        (a.order ?? 0) - (b.order ?? 0) || (a.created_at ?? '').localeCompare(b.created_at ?? '')
      )
    }
    return result
  }, [visible, today, tomorrow, week1end, week2end])

  const toggleStatus = useCallback((s: TaskStatus) =>
    setFilterStatus(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]),
  [])

  const toggleSection = useCallback((key: string, isEmpty: boolean) =>
    setCollapsedSections(p => {
      const current = p[key] !== undefined ? p[key] : isEmpty
      return { ...p, [key]: !current }
    }),
  [])

  const toggleExpand = useCallback((id: number) =>
    setExpandedCards(p => ({ ...p, [id]: !p[id] })),
  [])

  const openCreate = useCallback(() => setPanel({ open: true, mode: 'create', task: null }), [])
  const openEdit   = useCallback((task: Task) => setPanel({ open: true, mode: 'edit', task }), [])
  const closePanel = useCallback(() => setPanel(p => ({ ...p, open: false })), [])

  const handleCreateTask = useCallback(async (payload: Partial<Task>) => {
    try {
      const created = await createTask(payload)
      setTasks(prev => [created, ...prev])
      closePanel()
    } catch (err) {
      console.error('[TaskList] createTask failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [closePanel])

  const handleUpdateTask = useCallback(async (taskId: number, payload: Partial<Task>) => {
    try {
      const updated = await updateTask(taskId, payload)
      if (payload.status === 'done') {
        await load()
      } else {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updated } : t))
        setPanel(p => p.task?.id === taskId ? { ...p, task: { ...p.task!, ...updated } } : p)
      }
      closePanel()
    } catch (err) {
      console.error(`[TaskList] updateTask(${taskId}) failed:`, err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [load, closePanel])

  const patchTask = useCallback(async (taskId: number, data: Partial<Task>) => {
    const prevTask = tasksRef.current.find(t => t.id === taskId)
    try {
      if (data.status === 'done') {
        setDismissingIds(prev => new Set([...prev, taskId]))
        await new Promise(r => setTimeout(r, 320))
      }
      const updated = await updateTask(taskId, data)
      if (data.status === 'done') {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updated } : t))
        setDismissingIds(prev => { const s = new Set(prev); s.delete(taskId); return s })
        silentLoad()
      } else {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updated } : t))
        if (data.status === 'cancelled') silentLoad()
      }
      if (prevTask) {
        pushUndo({
          description: undoDescription(prevTask.title, data),
          undo: async () => {
            const revert = reversePayload(prevTask, data)
            const reverted = await updateTask(taskId, revert)
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...reverted } : t))
          },
        })
      }
    } catch (err) {
      setDismissingIds(prev => { const s = new Set(prev); s.delete(taskId); return s })
      console.error(`[TaskList] patchTask(${taskId}) failed:`, err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [silentLoad, pushUndo])

  const deleteTaskCb = useCallback(async (taskId: number) => {
    try {
      await deleteTask(taskId)
      setTasks(prev => prev.filter(t => t.id !== taskId))
    } catch (err) {
      console.error(`[TaskList] deleteTask(${taskId}) failed:`, err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const patchSubtask = useCallback(async (taskId: number, subtaskId: number, data: Partial<Subtask>) => {
    const prevTask = tasksRef.current.find(t => t.id === taskId)
    const prevSub  = prevTask?.subtasks?.find(s => s.id === subtaskId)
    try {
      const updated: Subtask = await updateSubtask(taskId, subtaskId, data)
      const applyUpdate = (subs: Subtask[] | undefined): Subtask[] =>
        (subs ?? []).map(s => s.id === subtaskId ? updated : s)
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: applyUpdate(t.subtasks) } : t
      ))
      setPanel(p => {
        if (!p.task || p.task.id !== taskId) return p
        return { ...p, task: { ...p.task, subtasks: applyUpdate(p.task.subtasks) } }
      })
      if (prevSub) {
        const desc = data.status === 'done'
          ? `Subtask "${prevSub.title}" checked`
          : data.status === 'todo'
          ? `Subtask "${prevSub.title}" unchecked`
          : `Subtask "${prevSub.title}" updated`
        pushUndo({
          description: desc,
          undo: async () => {
            const revert   = reversePayload(prevSub, data)
            const reverted: Subtask = await updateSubtask(taskId, subtaskId, revert)
            const applyRevert = (subs: Subtask[] | undefined): Subtask[] =>
              (subs ?? []).map(s => s.id === subtaskId ? reverted : s)
            setTasks(prev => prev.map(t =>
              t.id === taskId ? { ...t, subtasks: applyRevert(t.subtasks) } : t
            ))
            setPanel(p => {
              if (!p.task || p.task.id !== taskId) return p
              return { ...p, task: { ...p.task, subtasks: applyRevert(p.task.subtasks) } }
            })
          },
        })
      }
    } catch (err) {
      console.error('[TaskList] patchSubtask failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [pushUndo])

  const addSubtask = useCallback(async (taskId: number, title: string) => {
    try {
      const sub: Subtask = await createSubtask(taskId, { title })
      const updater = (t: Task): Task =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks ?? []), sub] } : t
      setTasks(prev => prev.map(updater))
      setPanel(p => p.task?.id === taskId ? { ...p, task: updater(p.task!) } : p)
    } catch (err) {
      console.error(`[TaskList] createSubtask(${taskId}) failed:`, err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const deleteSubtaskCb = useCallback(async (taskId: number, subtaskId: number) => {
    const prevTask = tasksRef.current.find(t => t.id === taskId)
    const prevSub  = prevTask?.subtasks?.find(s => s.id === subtaskId)
    try {
      await deleteSubtask(taskId, subtaskId)
      const updater = (t: Task): Task =>
        t.id === taskId ? { ...t, subtasks: (t.subtasks ?? []).filter(s => s.id !== subtaskId) } : t
      setTasks(prev => prev.map(updater))
      setPanel(p => p.task?.id === taskId ? { ...p, task: updater(p.task!) } : p)
      if (prevSub) {
        pushUndo({
          description: `Subtask "${prevSub.title}" deleted`,
          undo: async () => {
            const restored: Subtask = await createSubtask(taskId, {
              title:     prevSub.title,
              status:    prevSub.status,
              due_date:  prevSub.due_date ?? null,
              order:     prevSub.order,
            })
            const applyRestore = (t: Task): Task =>
              t.id === taskId ? { ...t, subtasks: [...(t.subtasks ?? []), restored] } : t
            setTasks(prev => prev.map(applyRestore))
            setPanel(p => p.task?.id === taskId ? { ...p, task: applyRestore(p.task!) } : p)
          },
        })
      }
    } catch (err) {
      console.error('[TaskList] deleteSubtask failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [pushUndo])

  const reorderTasks = useCallback(async (reorderedSectionTasks: Task[]) => {
    const withOrder = reorderedSectionTasks.map((t, i) => ({ ...t, order: i }))
    const byId = new Map(withOrder.map(t => [t.id, t]))
    setTasks(prev => prev.map(t => byId.get(t.id) ?? t))
    const original = tasksRef.current
    try {
      await Promise.all(
        withOrder
          .filter(t => {
            const prev = original.find(o => o.id === t.id)
            return prev && prev.order !== t.order
          })
          .map(t => updateTask(t.id, { order: t.order }))
      )
    } catch (err) {
      console.error('[TaskList] reorderTasks failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const reorderSubtasks = useCallback(async (taskId: number, reorderedSubs: Subtask[]) => {
    const withOrder = reorderedSubs.map((s, i) => ({ ...s, order: i }))
    const updater = (t: Task): Task => t.id === taskId ? { ...t, subtasks: withOrder } : t
    setTasks(prev => prev.map(updater))
    setPanel(p => p.task?.id === taskId ? { ...p, task: updater(p.task!) } : p)
    const original = tasksRef.current.find(t => t.id === taskId)?.subtasks ?? []
    try {
      await Promise.all(
        withOrder
          .filter(s => {
            const prev = original.find(o => o.id === s.id)
            return prev && prev.order !== s.order
          })
          .map(s => updateSubtask(taskId, s.id, { order: s.order }))
      )
    } catch (err) {
      console.error('[TaskList] reorderSubtasks failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  return (
    <div className="max-w-4xl mx-auto">
      <TaskToolbar
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        filterStatus={filterStatus}
        onToggleStatus={toggleStatus}
        filterAssignee={filterAssignee}
        onFilterAssignee={setFilterAssignee}
        filterCategory={filterCategory}
        onFilterCategory={setFilterCategory}
        persons={persons}
        categories={categories}
        loading={loading}
        onRefresh={load}
      />

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 rounded-xl
          bg-red-50 dark:bg-red-950/30
          border border-red-200 dark:border-red-900/60
          text-red-700 dark:text-red-400 text-sm">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex-shrink-0"
          >✕</button>
        </div>
      )}

      {!loading && tasks.length >= TASK_FETCH_LIMIT && (
        <div className="px-4 py-3 mb-4 rounded-xl
          bg-amber-50 dark:bg-amber-950/20
          border border-amber-200 dark:border-amber-900/50
          text-amber-700 dark:text-amber-400 text-sm">
          Showing the first {TASK_FETCH_LIMIT} tasks — some may not be visible.
        </div>
      )}

      {loading && (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm animate-pulse">
          Loading tasks…
        </div>
      )}

      {!loading && filterStatus.length === 0 && (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm italic">
          All status filters are off — enable at least one to see tasks.
        </div>
      )}

      {!loading && filterStatus.length > 0 && visible.length === 0 && (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm italic">
          No tasks match the current filters.
        </div>
      )}

      {!loading && filterStatus.length > 0 && visible.length > 0 && (
        <div>
          {SECTION_DEFS.map(({ key, label, hideWhenEmpty }) => {
            const sectionTasks: Task[] = grouped[key] ?? []
            const isEmpty = sectionTasks.length === 0
            if (hideWhenEmpty && isEmpty) return null
            const isCollapsed = collapsedSections[key] !== undefined
              ? collapsedSections[key]
              : key !== 'overdue' && key !== 'today'
            return (
              <TaskSection
                key={key}
                sectionKey={key}
                label={label}
                tasks={sectionTasks}
                collapsed={isCollapsed}
                onToggleCollapse={() => toggleSection(key, isEmpty)}
                expandedCards={expandedCards}
                onToggleExpand={toggleExpand}
                onEdit={openEdit}
                onPatchTask={patchTask}
                onDeleteTask={deleteTaskCb}
                onPatchSubtask={patchSubtask}
                onAddSubtask={addSubtask}
                onDeleteSubtask={deleteSubtaskCb}
                onReorderSubtasks={reorderSubtasks}
                onReorderTasks={reorderTasks}
                persons={persons}
                categories={categories}
                dismissingIds={dismissingIds}
              />
            )
          })}
        </div>
      )}

      <TaskPanel
        open={panel.open}
        mode={panel.mode}
        task={panel.task}
        onClose={closePanel}
        onCreateTask={handleCreateTask}
        onUpdateTask={handleUpdateTask}
        persons={persons}
        categories={categories}
        onPatchSubtask={patchSubtask}
        onAddSubtask={addSubtask}
        onDeleteSubtask={deleteSubtaskCb}
      />

      <UndoToast
        action={lastAction}
        onUndo={undo}
        onDismiss={dismissToast}
      />

      <button
        onClick={openCreate}
        title="New task"
        className={`fixed bottom-6 right-6 z-40
          w-14 h-14 rounded-full
          bg-white dark:bg-slate-800
          border border-slate-200 dark:border-slate-700
          text-slate-600 dark:text-slate-300
          shadow-md hover:shadow-lg
          hover:bg-slate-50 dark:hover:bg-slate-700
          hover:border-slate-300 dark:hover:border-slate-600
          transition-all duration-200 active:scale-95
          flex items-center justify-center
          text-2xl leading-none select-none
          ${panel.open ? 'hidden' : ''}`}
      >
        +
      </button>
    </div>
  )
}
