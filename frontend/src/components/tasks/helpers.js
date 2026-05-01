export const STATUS_OPTIONS = ['todo', 'in_progress', 'done', 'cancelled']
export const STATUS_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled' }
export const TASK_FETCH_LIMIT = 500

export const SECTION_DEFS = [
  { key: 'done',          label: 'Done',          hideWhenEmpty: true },
  { key: 'overdue_today', label: 'Overdue / Today' },
  { key: 'tomorrow',      label: 'Tomorrow' },
  { key: 'this_week',     label: 'This Week' },
  { key: 'next_week',     label: 'Next Week' },
  { key: 'later',         label: 'Later' },
  { key: 'no_date',       label: 'No Date',        hideWhenEmpty: true },
]

// Safe hex-alpha: handles #rrggbb and #rgb; passes through other formats
export function withAlpha(hex, alpha) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex + a
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const [, r, g, b] = hex
    return `#${r.repeat(2)}${g.repeat(2)}${b.repeat(2)}${a}`
  }
  return hex
}

export function isOverdue(task) {
  return (
    task.due_date &&
    new Date(task.due_date + 'T00:00:00') < new Date() &&
    task.status !== 'done' &&
    task.status !== 'cancelled'
  )
}

export function fmt(dateStr) {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function localDate(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyTask() {
  return {
    title: '', description: '', priority: 'medium', status: 'todo',
    due_date: localDate(), estimated_minutes: '',
    assignee_id: '', category_id: '', recurrence: 'none',
  }
}

export function undoDescription(title, data) {
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

export function reversePayload(prior, data) {
  const rev = {}
  for (const key of Object.keys(data)) rev[key] = prior[key] ?? null
  return rev
}

export function getDaysBadge(task, now = new Date()) {
  if (!task.due_date || task.status === 'done' || task.status === 'cancelled') return null
  const diff = Math.ceil((new Date(task.due_date + 'T00:00:00') - now) / 86400000)
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, cls: 'text-red-500 dark:text-red-400 font-semibold' }
  if (diff === 0) return { text: 'today', cls: 'text-amber-500 dark:text-amber-400 font-semibold' }
  if (diff <= 3) return { text: `${diff}d`, cls: 'text-amber-500 dark:text-amber-400' }
  return { text: `${diff}d`, cls: 'text-slate-400 dark:text-slate-500' }
}
