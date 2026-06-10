export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'ontime'
export type TaskPriority = 'high' | 'medium' | 'low'
export type RecurrenceOption = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'yearly'

export interface Category {
  id: number
  name: string
  icon: string
  color: string
}

export interface Person {
  id: number
  name: string
}

export interface Subtask {
  id: number
  title: string
  status: TaskStatus
  due_date?: string | null
  order: number
}

export interface Task {
  id: number
  title: string
  description?: string | null
  status: TaskStatus
  priority: TaskPriority
  due_date?: string | null
  estimated_minutes?: number | null
  assignee_id?: number | null
  assignee?: Person | null
  category_id?: number | null
  category?: Category | null
  recurrence?: RecurrenceOption | null
  recurrence_anchor_day?: number | null
  recurrence_anchor_month?: number | null
  subtasks?: Subtask[]
  order?: number
  created_at?: string
}

export interface NewTaskDraft {
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  due_date: string
  estimated_minutes: number | string
  assignee_id: number | string
  category_id: number | string
  recurrence: RecurrenceOption
}

export interface DaysBadge {
  text: string
  cls: string
}

export function parseMinutes(value: string | number): number | null {
  const n = parseInt(String(value), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function parseHumanMinutes(value: string): number | null {
  const s = value.trim()
  if (!s) return null
  // "2h30m", "2h 30m", "2.5h", "2h"
  const hm = s.match(/^(\d+(?:\.\d+)?)\s*h\s*(?:(\d+)\s*m?)?$/i)
  if (hm) {
    const total = Math.round(parseFloat(hm[1]) * 60) + (hm[2] ? parseInt(hm[2], 10) : 0)
    return total > 0 ? total : null
  }
  // "90m" or plain "90"
  const mo = s.match(/^(\d+)\s*m?$/i)
  if (mo) {
    const n = parseInt(mo[1], 10)
    return n > 0 ? n : null
  }
  return null
}

export function formatMinutes(mins: number | null | undefined): string | null {
  if (!mins || mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

export const STATUS_OPTIONS: TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled', 'ontime']
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
  ontime: 'On Time',
}
export const TASK_FETCH_LIMIT = 500

export interface SectionDef {
  key: string
  label: string
  hideWhenEmpty?: boolean
}

export const SECTION_DEFS: SectionDef[] = [
  { key: 'done',      label: 'Done',      hideWhenEmpty: true },
  { key: 'overdue',   label: 'Overdue' },
  { key: 'today',     label: 'Today' },
  { key: 'tomorrow',  label: 'Tomorrow' },
  { key: 'this_week', label: 'This Week' },
  { key: 'next_week', label: 'Next Week' },
  { key: 'later',     label: 'Later' },
  { key: 'no_date',   label: 'No Date',   hideWhenEmpty: true },
]

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex + a
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const [, r, g, b] = hex
    return `#${r.repeat(2)}${g.repeat(2)}${b.repeat(2)}${a}`
  }
  return hex
}

function parseDueDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00')
}

export function isOverdue(task: Task, now = new Date()): boolean {
  return !!(
    task.due_date &&
    parseDueDate(task.due_date) < now &&
    task.status !== 'done' &&
    task.status !== 'cancelled'
  )
}

export function fmt(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  return parseDueDate(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function localDate(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyTask(): NewTaskDraft {
  return {
    title: '', description: '', priority: 'medium', status: 'todo',
    due_date: localDate(), estimated_minutes: '',
    assignee_id: '', category_id: '', recurrence: 'none',
  }
}

export function undoDescription(title: string, data: Partial<Task>): string {
  if (data.status === 'done')        return `"${title}" marked as done`
  if (data.status === 'in_progress') return `"${title}" started`
  if (data.status === 'cancelled')   return `"${title}" cancelled`
  if (data.status === 'todo')        return `"${title}" reopened`
  if ('title' in data)               return `"${title}" renamed`
  if ('category_id' in data)         return `Category changed on "${title}"`
  if ('due_date' in data)            return `Due date changed on "${title}"`
  if ('assignee_id' in data)         return `Assignee changed on "${title}"`
  if ('estimated_minutes' in data)   return `Duration changed on "${title}"`
  return `"${title}" updated`
}

export function reversePayload(prior: Partial<Task>, data: Partial<Task>): Partial<Task> {
  const rev: Partial<Task> = {}
  for (const key of Object.keys(data) as Array<keyof Task>) {
    (rev as Record<string, unknown>)[key] = prior[key] ?? null
  }
  return rev
}

const MS_PER_DAY = 86_400_000

export function getDaysBadge(task: Task, now = new Date()): DaysBadge | null {
  if (!task.due_date || task.status === 'done' || task.status === 'cancelled') return null
  const diff = Math.ceil((parseDueDate(task.due_date).getTime() - now.getTime()) / MS_PER_DAY)
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, cls: 'text-red-500 dark:text-red-400 font-semibold' }
  if (diff === 0) return { text: 'today', cls: 'text-amber-500 dark:text-amber-400 font-semibold' }
  if (diff <= 3) return { text: `${diff}d`, cls: 'text-amber-500 dark:text-amber-400' }
  return { text: `${diff}d`, cls: 'text-slate-400 dark:text-slate-500' }
}
