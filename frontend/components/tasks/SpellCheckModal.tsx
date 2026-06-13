'use client'
import { useState, useEffect, useRef } from 'react'
import { SpellCheck } from 'lucide-react'
import type { Task, Subtask } from './helpers'

const SMALL_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'at', 'by', 'in', 'of', 'on', 'to', 'up', 'as', 'if', 'via',
])

function toTitleCase(title: string): string {
  const words = title.split(/(\s+)/)
  return words
    .map((token, i) => {
      if (/^\s+$/.test(token)) return token
      const wordIndex = words.slice(0, i).filter(t => !/^\s+$/.test(t)).length
      const isFirst = wordIndex === 0
      const clean = token.replace(/^[^a-zA-Z]+/, '').replace(/[^a-zA-Z]+$/, '')
      if (!clean) return token
      if (isFirst || !SMALL_WORDS.has(clean.toLowerCase())) {
        return token.charAt(0).toUpperCase() + token.slice(1)
      }
      return token.charAt(0).toLowerCase() + token.slice(1)
    })
    .join('')
}

function needsTitleCase(title: string): boolean {
  return toTitleCase(title) !== title
}

function skipKey(patchKey: string, type: string, word?: string): string {
  return `${patchKey}:${type}:${word ?? ''}`
}

interface Issue {
  taskId: number
  subtaskId?: number        // undefined = task issue
  title: string             // the title being checked
  parentTitle?: string      // parent task title, shown for context on subtask issues
  type: 'capitalization' | 'spelling'
  word?: string
  suggestion: string
  patchKey: string          // "t:<taskId>" or "s:<subtaskId>"
}

interface SpellCheckModalProps {
  open: boolean
  tasks: Task[]
  onClose: () => void
  onUpdateTask: (taskId: number, payload: Partial<Task>) => Promise<void>
  onUpdateSubtask: (taskId: number, subtaskId: number, payload: Partial<Subtask>) => Promise<void> | void
}

export default function SpellCheckModal({
  open, tasks, onClose, onUpdateTask, onUpdateSubtask,
}: SpellCheckModalProps) {
  const [issues, setIssues]               = useState<Issue[]>([])
  const [index, setIndex]                 = useState(0)
  const [editValue, setEditValue]         = useState('')
  const [scanning, setScanning]           = useState(false)
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [patchedTitles, setPatchedTitles] = useState<Map<string, string>>(new Map())
  const inputRef    = useRef<HTMLInputElement>(null)
  const skippedRef  = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setIndex(0)
    setPatchedTitles(new Map())
    setError(null)
    scan()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tasks])

  useEffect(() => {
    if (issues.length > 0 && index < issues.length) {
      setEditValue(issues[index].suggestion)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [index, issues])

  async function scan() {
    setScanning(true)
    setIssues([])

    const capIssues: Issue[] = []
    const spellingIssues: Issue[] = []

    // Capitalization check — tasks
    for (const task of tasks) {
      if (needsTitleCase(task.title)) {
        capIssues.push({
          taskId:     task.id,
          title:      task.title,
          type:       'capitalization',
          suggestion: toTitleCase(task.title),
          patchKey:   `t:${task.id}`,
        })
      }
      // Capitalization check — subtasks
      for (const sub of task.subtasks ?? []) {
        if (needsTitleCase(sub.title)) {
          capIssues.push({
            taskId:      task.id,
            subtaskId:   sub.id,
            title:       sub.title,
            parentTitle: task.title,
            type:        'capitalization',
            suggestion:  toTitleCase(sub.title),
            patchKey:    `s:${sub.id}`,
          })
        }
      }
    }

    // Spelling check — collect all words from tasks + subtasks
    try {
      const wordSet = new Set<string>()
      for (const task of tasks) {
        for (const text of [task.title, ...(task.subtasks ?? []).map(s => s.title)]) {
          text.split(/\s+/).forEach(raw => {
            const w = raw.replace(/[^a-zA-Z']/g, '')
            if (w.length >= 3) wordSet.add(w)
          })
        }
      }

      const res = await fetch('/internal/spellcheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: [...wordSet] }),
      })
      if (res.ok) {
        const { misspelled } = await res.json() as { misspelled: string[] }
        const badWords = new Set(misspelled)

        for (const task of tasks) {
          // Task title
          for (const raw of task.title.split(/\s+/)) {
            const w = raw.replace(/[^a-zA-Z']/g, '')
            if (badWords.has(w)) {
              spellingIssues.push({
                taskId:   task.id,
                title:    task.title,
                type:     'spelling',
                word:     w,
                suggestion: task.title,
                patchKey: `t:${task.id}`,
              })
              break
            }
          }
          // Subtask titles
          for (const sub of task.subtasks ?? []) {
            for (const raw of sub.title.split(/\s+/)) {
              const w = raw.replace(/[^a-zA-Z']/g, '')
              if (badWords.has(w)) {
                spellingIssues.push({
                  taskId:      task.id,
                  subtaskId:   sub.id,
                  title:       sub.title,
                  parentTitle: task.title,
                  type:        'spelling',
                  word:        w,
                  suggestion:  sub.title,
                  patchKey:    `s:${sub.id}`,
                })
                break
              }
            }
          }
        }
      }
    } catch {
      // spell check unavailable — capitalization issues still shown
    }

    const all = [...capIssues, ...spellingIssues]
      .filter(i => !skippedRef.current.has(skipKey(i.patchKey, i.type, i.word)))
    setIssues(all)
    if (all.length > 0) setEditValue(all[0].suggestion)
    setScanning(false)
  }

  async function applyFix() {
    const issue = issues[index]
    if (!issue) return
    const newTitle = editValue.trim()
    if (!newTitle || newTitle === issue.title) {
      advance()
      return
    }
    setSaving(true)
    try {
      if (issue.subtaskId != null) {
        await onUpdateSubtask(issue.taskId, issue.subtaskId, { title: newTitle })
      } else {
        await onUpdateTask(issue.taskId, { title: newTitle })
      }
      setPatchedTitles(prev => new Map(prev).set(issue.patchKey, newTitle))
      advance()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function advance() {
    if (index + 1 >= issues.length) {
      onClose()
    } else {
      const next = index + 1
      setIndex(next)
      const nextIssue = issues[next]
      const currentTitle = patchedTitles.get(nextIssue.patchKey) ?? nextIssue.title
      setEditValue(
        nextIssue.type === 'capitalization' ? toTitleCase(currentTitle) : currentTitle
      )
    }
  }

  function skip() {
    const issue = issues[index]
    if (issue) skippedRef.current.add(skipKey(issue.patchKey, issue.type, issue.word))
    advance()
  }

  if (!open) return null

  const issue = issues[index]
  const total = issues.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700/60 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700/60">
          <div className="flex items-center gap-2">
            <SpellCheck size={16} className="text-slate-500 dark:text-slate-400" />
            <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
              Spell Check
            </span>
            {!scanning && total > 0 && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                · {index + 1} of {total}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 min-h-[200px] flex flex-col justify-center">
          {scanning && (
            <p className="text-center text-slate-400 dark:text-slate-500 text-sm animate-pulse">
              Scanning tasks…
            </p>
          )}

          {!scanning && total === 0 && (
            <div className="text-center space-y-1">
              <p className="text-emerald-600 dark:text-emerald-400 font-medium text-sm">
                No issues found!
              </p>
              <p className="text-slate-400 dark:text-slate-500 text-xs">
                All visible task and subtask titles look good.
              </p>
            </div>
          )}

          {!scanning && issue && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold
                  ${issue.type === 'capitalization'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                  }`}
                >
                  {issue.type === 'capitalization' ? 'Title Case' : 'Spelling'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {issue.subtaskId != null ? 'Subtask' : 'Task'}
                </span>
                {issue.type === 'spelling' && issue.word && (
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    Possible misspelling: <span className="font-mono font-semibold text-red-600 dark:text-red-400">"{issue.word}"</span>
                  </span>
                )}
              </div>

              {issue.parentTitle && (
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                    Parent task
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono truncate">
                    {issue.parentTitle}
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                  Current {issue.subtaskId != null ? 'subtask' : 'task'} title
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-300 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono">
                  {patchedTitles.get(issue.patchKey) ?? issue.title}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                  {issue.type === 'capitalization' ? 'Suggested fix' : 'Edit to fix'}
                </p>
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') applyFix()
                    if (e.key === 'Escape') skip()
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg
                    bg-white dark:bg-slate-800
                    border border-blue-400 dark:border-blue-500
                    text-slate-800 dark:text-slate-200
                    focus:outline-none focus:ring-2 focus:ring-blue-500/50
                    transition-shadow font-mono"
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!scanning && (
          <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700/60">
            {total === 0 ? (
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold
                  bg-blue-600 hover:bg-blue-500 text-white
                  shadow-sm shadow-blue-500/25 transition-all active:scale-[0.98]"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  onClick={applyFix}
                  disabled={saving || !editValue.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold
                    bg-blue-600 hover:bg-blue-500 text-white
                    disabled:opacity-50 disabled:cursor-not-allowed
                    shadow-sm shadow-blue-500/25 transition-all active:scale-[0.98]"
                >
                  {saving ? 'Saving…' : 'Apply Fix'}
                </button>
                <button
                  onClick={skip}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium
                    bg-slate-100 dark:bg-slate-800
                    text-slate-600 dark:text-slate-300
                    hover:bg-slate-200 dark:hover:bg-slate-700
                    disabled:opacity-50 transition-colors"
                >
                  {index + 1 === total ? 'Done' : 'Skip'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
