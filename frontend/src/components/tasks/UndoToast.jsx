import React, { useEffect, useState, useRef } from 'react'

const TOAST_MS = 8000
const FADE_MS  = 300

/**
 * Fixed bottom toast that appears after each undoable action.
 * Auto-dismisses after 8 seconds. Resets the timer whenever `action` changes.
 */
export default function UndoToast({ action, onUndo, onDismiss }) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!action) {
      setVisible(false)
      return
    }
    // New action — show toast and restart the 8s countdown
    setVisible(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setVisible(false)
      setTimeout(onDismiss, FADE_MS)
    }, TOAST_MS)

    return () => clearTimeout(timerRef.current)
  }, [action])  // action.id changes on every push, so this always resets

  function handleDismiss() {
    clearTimeout(timerRef.current)
    setVisible(false)
    setTimeout(onDismiss, FADE_MS)
  }

  function handleUndo() {
    clearTimeout(timerRef.current)
    setVisible(false)
    setTimeout(onDismiss, FADE_MS)
    onUndo()
  }

  // Keep in DOM during fade-out so the CSS transition plays
  if (!action && !visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        fixed bottom-6 left-1/2 -translate-x-1/2 z-50
        flex items-center gap-3 pl-4 pr-3 py-3 rounded-xl
        bg-slate-800 dark:bg-slate-700 text-white
        shadow-2xl shadow-black/50
        transition-all duration-300 ease-in-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}
      `}
    >
      <span className="text-sm text-slate-100 whitespace-nowrap">{action?.description}</span>

      <button
        onClick={handleUndo}
        className="flex items-center gap-1.5 text-sm font-semibold
          text-blue-400 hover:text-blue-300
          px-2.5 py-1 rounded-lg
          border border-blue-500/40 hover:border-blue-400/60
          hover:bg-blue-500/10
          transition-all whitespace-nowrap"
      >
        ↩ Undo
      </button>

      <span className="text-xs text-slate-500 font-mono whitespace-nowrap hidden sm:inline">
        Ctrl+Z
      </span>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="w-6 h-6 flex items-center justify-center rounded-lg
          text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
      >
        ✕
      </button>
    </div>
  )
}
