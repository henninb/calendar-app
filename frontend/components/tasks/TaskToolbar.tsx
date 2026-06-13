'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { CloudUpload, SlidersHorizontal, RefreshCw, X, ArrowUpDown, LayoutGrid, SpellCheck } from 'lucide-react'
import { STATUS_OPTIONS, STATUS_LABELS } from './helpers'
import type { TaskStatus, Person, Category } from './helpers'
import { gcalAuthStatus, syncToGtasks } from '@/lib/api'

const STATUS_PILL_ACTIVE: Record<TaskStatus, string> = {
  todo:        'bg-blue-100 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:ring-blue-500/40',
  in_progress: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-500/40',
  done:        'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/40',
  cancelled:   'bg-slate-200 text-slate-600 ring-1 ring-slate-300 dark:bg-slate-600/40 dark:text-slate-300 dark:ring-slate-500/40',
  ontime:      'bg-teal-100 text-teal-700 ring-1 ring-teal-300 dark:bg-teal-500/20 dark:text-teal-300 dark:ring-teal-500/40',
}

type LogLevel = 'info' | 'ok' | 'warn' | 'error'
interface LogEntry { id: number; level: LogLevel; text: string; time: string }

const LOG_COLOR: Record<LogLevel, string> = {
  info:  'text-blue-300',
  ok:    'text-emerald-300',
  warn:  'text-amber-300',
  error: 'text-red-300',
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface FilterPopoverProps {
  filterStatus: TaskStatus[]
  onToggleStatus: (status: TaskStatus) => void
  filterAssignee: string
  onFilterAssignee: (value: string) => void
  filterCategory: string
  onFilterCategory: (value: string) => void
  persons: Person[]
  categories: Category[]
  onClose: () => void
}

function FilterPopover({
  filterStatus, onToggleStatus,
  filterAssignee, onFilterAssignee,
  filterCategory, onFilterCategory,
  persons, categories, onClose,
}: FilterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const activeCount =
    (filterStatus.length < STATUS_OPTIONS.length ? 1 : 0) +
    (filterAssignee ? 1 : 0) +
    (filterCategory ? 1 : 0)

  const inputCls = `w-full px-3 py-1.5 text-sm rounded-lg
    bg-white dark:bg-slate-800
    border border-slate-200 dark:border-slate-700
    text-slate-800 dark:text-slate-200
    focus:outline-none focus:ring-2 focus:ring-blue-500/50`

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 z-30 w-72
        bg-white dark:bg-slate-900
        border border-slate-200 dark:border-slate-700
        rounded-2xl shadow-2xl p-4 space-y-4"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filters</span>
        {activeCount > 0 && (
          <button
            onClick={() => {
              STATUS_OPTIONS.forEach(s => { if (!filterStatus.includes(s)) onToggleStatus(s) })
              onFilterAssignee('')
              onFilterCategory('')
            }}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => onToggleStatus(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all
                ${filterStatus.includes(s)
                  ? STATUS_PILL_ACTIVE[s]
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {persons.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Assignee</p>
          <select value={filterAssignee} onChange={e => onFilterAssignee(e.target.value)} className={inputCls}>
            <option value="">All</option>
            <option value="unassigned">Unassigned</option>
            {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {categories.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Category</p>
          <select value={filterCategory} onChange={e => onFilterCategory(e.target.value)} className={inputCls}>
            <option value="">All</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

export type SortField = 'due_date' | 'priority' | 'created_at'
export type SortDir   = 'asc' | 'desc'

const SORT_LABELS: Record<SortField, string> = {
  due_date:   'Due date',
  priority:   'Priority',
  created_at: 'Created',
}

interface TaskToolbarProps {
  searchQuery: string
  onSearch: (query: string) => void
  filterStatus: TaskStatus[]
  onToggleStatus: (status: TaskStatus) => void
  filterAssignee: string
  onFilterAssignee: (value: string) => void
  filterCategory: string
  onFilterCategory: (value: string) => void
  persons: Person[]
  categories: Category[]
  loading: boolean
  onRefresh: () => void
  sortField: SortField
  sortDir: SortDir
  onSort: (field: SortField, dir: SortDir) => void
  onOpenPlanner: () => void
  onSpellCheck: () => void
}

export default function TaskToolbar({
  searchQuery,
  onSearch,
  filterStatus,
  onToggleStatus,
  filterAssignee,
  onFilterAssignee,
  filterCategory,
  onFilterCategory,
  persons,
  categories,
  loading,
  onRefresh,
  sortField,
  sortDir,
  onSort,
  onOpenPlanner,
  onSpellCheck,
}: TaskToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen]     = useState(false)
  const sortBtnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sortOpen) return
    function handle(e: MouseEvent) {
      if (sortBtnRef.current && !sortBtnRef.current.contains(e.target as Node)) setSortOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [sortOpen])

  const [gtasksSyncing, setGtasksSyncing] = useState(false)
  const [gcalAuth, setGcalAuth]           = useState<boolean | null>(null)
  const [logs, setLogs]                   = useState<LogEntry[]>([])
  const [logCount, setLogCount]           = useState(0)
  const logEndRef                         = useRef<HTMLDivElement>(null)

  useEffect(() => {
    gcalAuthStatus()
      .then((s: { authenticated: boolean }) => setGcalAuth(s.authenticated))
      .catch(() => setGcalAuth(false))
  }, [])

  const addLog = useCallback((level: LogLevel, text: string): number => {
    const id = Date.now() + Math.random()
    setLogs(prev => [...prev, { id, level, text, time: timestamp() }])
    setLogCount(c => c + 1)
    return id
  }, [])

  const updateLog = useCallback((id: number, text: string) => {
    setLogs(prev => prev.map(entry => entry.id === id ? { ...entry, text } : entry))
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logCount])

  const handleGtasksSync = async () => {
    if (!gcalAuth) {
      window.location.href = '/api/sync/auth'
      return
    }
    setGtasksSyncing(true)
    addLog('info', 'Syncing tasks to Google Tasks…')
    const progressId = addLog('info', 'Waiting for server…')
    try {
      const res = await syncToGtasks((data: { type: string; total?: number; msg?: string }) => {
        if (data.type === 'start') {
          updateLog(progressId, `[gtasks sync] 0/${data.total} starting…`)
        } else if (data.type === 'progress') {
          updateLog(progressId, `[gtasks sync] ${data.msg}`)
        }
      })
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      const level: LogLevel = res.failed > 0 ? 'warn' : 'ok'
      addLog(level, `Synced ${res.synced} tasks to Google Tasks.${res.failed ? ` ${res.failed} failed.` : ''}`)
      if (res.failed > 0) {
        const quotaErrors = (res.errors as string[] | undefined)?.filter((e: string) => e.includes('quotaExceeded') || e.includes('Quota Exceeded')) ?? []
        if (quotaErrors.length > 0) {
          addLog('warn', 'Google Tasks API quota exceeded — daily limit reached.')
        } else {
          addLog('warn', `${res.failed} task(s) failed to sync — you may need to reconnect Google.`)
          ;(res.errors as string[] | undefined)?.slice(0, 5).forEach((err: string) => addLog('error', err))
        }
      }
    } catch (e) {
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      addLog('error', `Google Tasks sync failed: ${errMsg(e)}`)
    } finally {
      setGtasksSyncing(false)
    }
  }

  const activeFilterCount =
    (filterStatus.length < STATUS_OPTIONS.length ? 1 : 0) +
    (filterAssignee ? 1 : 0) +
    (filterCategory ? 1 : 0)

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleGtasksSync}
          disabled={gtasksSyncing}
          title={gcalAuth ? 'Sync tasks to Google Tasks' : 'Connect your Google account to enable Google Tasks sync'}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all
            disabled:opacity-50 disabled:cursor-not-allowed
            bg-white dark:bg-slate-800
            border border-slate-200 dark:border-slate-700
            text-slate-600 dark:text-slate-300
            hover:border-slate-300 dark:hover:border-slate-600"
        >
          <CloudUpload size={14} />
          {gtasksSyncing ? 'Syncing…' : 'Google Sync'}
        </button>

        <button
          onClick={onOpenPlanner}
          title="Task planner — 10,000-foot view"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all
            bg-white dark:bg-slate-800
            border border-slate-200 dark:border-slate-700
            text-slate-600 dark:text-slate-300
            hover:border-slate-300 dark:hover:border-slate-600"
        >
          <LayoutGrid size={14} />
          Plan
        </button>

        <button
          onClick={onSpellCheck}
          title="Check spelling and capitalization in visible task titles"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all
            bg-white dark:bg-slate-800
            border border-slate-200 dark:border-slate-700
            text-slate-600 dark:text-slate-300
            hover:border-slate-300 dark:hover:border-slate-600"
        >
          <SpellCheck size={14} />
          Spell Check
        </button>

        <div className="flex-1" />

        <input
          type="search"
          placeholder="Search tasks…"
          value={searchQuery}
          onChange={e => onSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-xl w-44 md:w-64
            bg-white dark:bg-slate-700
            border border-slate-200 dark:border-slate-600
            text-slate-800 dark:text-slate-200
            placeholder-slate-400 dark:placeholder-slate-400
            focus:outline-none focus:ring-2 focus:ring-blue-500/50
            transition-shadow"
        />

        <div className="relative">
          <button
            onClick={() => setFilterOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all
              ${filterOpen || activeFilterCount > 0
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/25'
                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
          >
            <SlidersHorizontal size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-0.5 w-5 h-5 rounded-full bg-white/20 text-xs font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          {filterOpen && (
            <FilterPopover
              filterStatus={filterStatus}
              onToggleStatus={onToggleStatus}
              filterAssignee={filterAssignee}
              onFilterAssignee={onFilterAssignee}
              filterCategory={filterCategory}
              onFilterCategory={onFilterCategory}
              persons={persons}
              categories={categories}
              onClose={() => setFilterOpen(false)}
            />
          )}
        </div>

        <div ref={sortBtnRef} className="relative">
          <button
            onClick={() => setSortOpen(o => !o)}
            title="Sort tasks"
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all
              ${sortOpen || sortField !== 'due_date'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/25'
                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
          >
            <ArrowUpDown size={14} />
            {SORT_LABELS[sortField]}
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-2 z-30 w-52
              bg-white dark:bg-slate-900
              border border-slate-200 dark:border-slate-700
              rounded-2xl shadow-2xl p-3 space-y-1">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide px-1 mb-2">Sort by</p>
              {(['due_date', 'priority', 'created_at'] as SortField[]).map(field => (
                <div key={field} className="flex items-center gap-1">
                  <button
                    onClick={() => { onSort(field, sortDir); setSortOpen(false) }}
                    className={`flex-1 text-left px-3 py-1.5 rounded-lg text-sm transition-colors
                      ${sortField === field
                        ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                  >
                    {SORT_LABELS[field]}
                  </button>
                  {sortField === field && (
                    <button
                      onClick={() => { onSort(field, sortDir === 'asc' ? 'desc' : 'asc'); setSortOpen(false) }}
                      title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors text-xs font-bold"
                    >
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          title="Reload tasks from server"
          aria-label="Reload tasks from server"
          className="p-2 rounded-xl
            bg-white dark:bg-slate-800
            border border-slate-200 dark:border-slate-700
            text-slate-600 dark:text-slate-300
            hover:border-slate-300 dark:hover:border-slate-600
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {logs.length > 0 && (
        <div className="relative rounded-xl border border-slate-700 bg-slate-900 dark:bg-slate-950">
          <button
            onClick={() => setLogs([])}
            title="Clear log"
            className="absolute top-2 right-2 p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 transition-colors"
          >
            <X size={13} />
          </button>
          <div
            className="px-4 py-3 pr-8 max-h-24 overflow-y-auto font-mono text-xs space-y-0.5"
          >
            {logs.map(entry => (
              <div key={entry.id} className={`leading-relaxed ${LOG_COLOR[entry.level]}`}>
                <span className="opacity-50 mr-3">{entry.time}</span>
                {entry.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}
