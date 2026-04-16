import React, { useState, useRef, useEffect } from 'react'
import { STATUS_OPTIONS, STATUS_LABELS } from './helpers'

const STATUS_PILL_ACTIVE = {
  todo:        'bg-blue-100 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:ring-blue-500/40',
  in_progress: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-500/40',
  done:        'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/40',
  cancelled:   'bg-slate-200 text-slate-600 ring-1 ring-slate-300 dark:bg-slate-600/40 dark:text-slate-300 dark:ring-slate-500/40',
}

function FilterPopover({ filterStatus, onToggleStatus, filterAssignee, onFilterAssignee, filterCategory, onFilterCategory, persons, categories, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
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
      className="absolute left-0 top-full mt-2 z-30 w-72
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

      {/* Status */}
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

      {/* Assignee */}
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

      {/* Category */}
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
  onNewTask,
}) {
  const [filterOpen, setFilterOpen] = useState(false)

  const activeFilterCount =
    (filterStatus.length < STATUS_OPTIONS.length ? 1 : 0) +
    (filterAssignee ? 1 : 0) +
    (filterCategory ? 1 : 0)

  return (
    <div className="flex items-center gap-2.5 flex-wrap mb-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
        <input
          type="search"
          placeholder="Search tasks…"
          value={searchQuery}
          onChange={e => onSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-sm rounded-xl
            bg-white dark:bg-slate-800
            border border-slate-200 dark:border-slate-700
            text-slate-800 dark:text-slate-200
            placeholder-slate-400 dark:placeholder-slate-500
            focus:outline-none focus:ring-2 focus:ring-blue-500/50
            transition-shadow"
        />
      </div>

      {/* Filters button */}
      <div className="relative">
        <button
          onClick={() => setFilterOpen(o => !o)}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all
            ${filterOpen || activeFilterCount > 0
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/25'
              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
        >
          <span>⚙</span>
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

      <div className="flex-1" />

      {/* Refresh */}
      <button
        onClick={onRefresh}
        disabled={loading}
        title="Reload tasks from server"
        className="px-3.5 py-2 rounded-xl text-sm font-medium
          bg-white dark:bg-slate-800
          border border-slate-200 dark:border-slate-700
          text-slate-600 dark:text-slate-300
          hover:border-slate-300 dark:hover:border-slate-600
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-all"
      >
        {loading ? '…' : '↻ Refresh'}
      </button>

      {/* New Task */}
      <button
        onClick={onNewTask}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold
          bg-blue-600 hover:bg-blue-500 text-white
          shadow-sm shadow-blue-500/25
          transition-all active:scale-95"
      >
        <span className="text-base leading-none">+</span>
        New Task
      </button>
    </div>
  )
}
