'use client'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Task, TaskStatus } from './helpers'
import { STATUS_LABELS } from './helpers'

interface CommandItem {
  id: string
  label: string
  description?: string
  shortcut?: string
  icon: string
  group: 'action' | 'task'
  danger?: boolean
  onSelect: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  tasks: Task[]
  onOpenCreate: () => void
  onEditTask: (task: Task) => void
  onPatchTask: (id: number, data: Partial<Task>) => void
}

export default function CommandPalette({
  open, onClose, tasks, onOpenCreate, onEditTask, onPatchTask,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  const staticActions: CommandItem[] = useMemo(() => [
    {
      id: 'new',
      label: 'New task',
      shortcut: '⌘N',
      icon: '○',
      group: 'action',
      onSelect: () => { onClose(); onOpenCreate() },
    },
  ], [onClose, onOpenCreate])

  const taskItems: CommandItem[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return tasks
      .filter(t => t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
      .slice(0, 8)
      .flatMap(t => {
        const base: CommandItem = {
          id: `task-${t.id}`,
          label: t.title,
          description: STATUS_LABELS[t.status],
          icon: t.status === 'done' ? '✓' : t.status === 'in_progress' ? '◑' : '○',
          group: 'task',
          onSelect: () => { onClose(); onEditTask(t) },
        }
        const actions: CommandItem[] = []
        if (t.status !== 'done' && t.status !== 'cancelled') {
          actions.push({
            id: `done-${t.id}`,
            label: `Mark done — ${t.title}`,
            icon: '✓',
            group: 'action',
            onSelect: () => { onClose(); onPatchTask(t.id, { status: 'done' }) },
          })
        }
        if (t.status === 'todo') {
          actions.push({
            id: `start-${t.id}`,
            label: `Start — ${t.title}`,
            icon: '▶',
            group: 'action',
            onSelect: () => { onClose(); onPatchTask(t.id, { status: 'in_progress' as TaskStatus }) },
          })
        }
        return [base, ...actions]
      })
  }, [query, tasks, onClose, onEditTask, onPatchTask])

  const items: CommandItem[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = staticActions.filter(a => !q || a.label.toLowerCase().includes(q))
    return [...filtered, ...taskItems]
  }, [staticActions, taskItems, query])

  useEffect(() => { setActiveIdx(0) }, [items.length])

  const scrollActiveIntoView = useCallback((idx: number) => {
    const el = listRef.current?.querySelectorAll('[data-cmd-item]')[idx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => { const next = Math.min(i + 1, items.length - 1); scrollActiveIntoView(next); return next })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => { const next = Math.max(i - 1, 0); scrollActiveIntoView(next); return next })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[activeIdx]?.onSelect()
    }
  }

  if (!open) return null

  const actionItems = items.filter(i => i.group === 'action')
  const taskResults = items.filter(i => i.group === 'task')

  let globalIdx = 0

  function renderItem(item: CommandItem) {
    const idx = globalIdx++
    const isActive = idx === activeIdx
    return (
      <button
        key={item.id}
        data-cmd-item
        onMouseEnter={() => setActiveIdx(idx)}
        onClick={() => item.onSelect()}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors rounded-lg
          ${isActive
            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-200'
            : item.danger
              ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
          }`}
      >
        <span className="w-5 text-center text-base opacity-70 flex-shrink-0">{item.icon}</span>
        <span className="flex-1 min-w-0">
          <span className="font-medium truncate block">{item.label}</span>
          {item.description && (
            <span className="text-xs text-slate-400 dark:text-slate-500 truncate block">{item.description}</span>
          )}
        </span>
        {item.shortcut && (
          <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0 font-mono">{item.shortcut}</span>
        )}
      </button>
    )
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700/60 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <span className="text-slate-400 dark:text-slate-500 text-sm">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search tasks or type a command…"
            className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-2 space-y-0.5">
          {items.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No results</p>
          )}

          {actionItems.length > 0 && (
            <>
              <p className="px-3 pt-1 pb-0.5 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Actions</p>
              {actionItems.map(renderItem)}
            </>
          )}

          {taskResults.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-0.5 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Tasks</p>
              {taskResults.map(renderItem)}
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
