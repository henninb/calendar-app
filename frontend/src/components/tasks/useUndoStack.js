import { useState, useCallback, useRef } from 'react'

const MAX_HISTORY = 15

/**
 * Manages a bounded undo stack.
 * Uses a ref for synchronous access (avoids stale closures in async callbacks)
 * and a derived state counter to drive reactive `canUndo`.
 */
export function useUndoStack() {
  const stackRef  = useRef([])            // [{ id, description, undo }]
  const [len, setLen] = useState(0)       // mirrors stackRef.current.length for reactivity
  const [lastAction, setLastAction] = useState(null)

  const push = useCallback((entry) => {
    const full = { ...entry, id: Date.now() + Math.random() }
    const next = [...stackRef.current.slice(-(MAX_HISTORY - 1)), full]
    stackRef.current = next
    setLen(next.length)
    setLastAction(full)
  }, [])

  // Pops the top entry and calls its undo function.
  // Safe to call when stack is empty — becomes a no-op.
  const undo = useCallback(async () => {
    const stack = stackRef.current
    if (stack.length === 0) return
    const entry = stack[stack.length - 1]
    const next  = stack.slice(0, -1)
    stackRef.current = next
    setLen(next.length)
    setLastAction(null)
    await entry.undo()
  }, [])

  const dismissToast = useCallback(() => setLastAction(null), [])

  return {
    push,
    undo,
    canUndo: len > 0,
    lastAction,
    dismissToast,
  }
}
