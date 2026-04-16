import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUndoStack } from '../useUndoStack'

function makeEntry(overrides = {}) {
  return {
    description: 'Test action',
    undo: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useUndoStack', () => {
  it('starts with an empty stack', () => {
    const { result } = renderHook(() => useUndoStack())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.lastAction).toBeNull()
  })

  it('push adds an entry and sets canUndo to true', () => {
    const { result } = renderHook(() => useUndoStack())
    const entry = makeEntry()

    act(() => { result.current.push(entry) })

    expect(result.current.canUndo).toBe(true)
  })

  it('push sets lastAction to the pushed entry (with added id)', () => {
    const { result } = renderHook(() => useUndoStack())
    const entry = makeEntry({ description: 'My action' })

    act(() => { result.current.push(entry) })

    expect(result.current.lastAction).not.toBeNull()
    expect(result.current.lastAction.description).toBe('My action')
    expect(typeof result.current.lastAction.id).toBe('number')
  })

  it('undo pops the top entry, calls its undo fn, and clears lastAction', async () => {
    const { result } = renderHook(() => useUndoStack())
    const entry = makeEntry()

    act(() => { result.current.push(entry) })
    await act(async () => { await result.current.undo() })

    expect(entry.undo).toHaveBeenCalledOnce()
    expect(result.current.canUndo).toBe(false)
    expect(result.current.lastAction).toBeNull()
  })

  it('undo is a no-op when the stack is empty', async () => {
    const { result } = renderHook(() => useUndoStack())

    await act(async () => { await result.current.undo() })

    expect(result.current.canUndo).toBe(false)
  })

  it('undo works in LIFO order across multiple pushes', async () => {
    const { result } = renderHook(() => useUndoStack())
    const first  = makeEntry({ description: 'first' })
    const second = makeEntry({ description: 'second' })

    act(() => { result.current.push(first) })
    act(() => { result.current.push(second) })

    await act(async () => { await result.current.undo() })

    expect(second.undo).toHaveBeenCalledOnce()
    expect(first.undo).not.toHaveBeenCalled()
    expect(result.current.canUndo).toBe(true)
  })

  it('caps the stack at 15 entries (MAX_HISTORY)', async () => {
    const { result } = renderHook(() => useUndoStack())

    act(() => {
      for (let i = 0; i < 20; i++) {
        result.current.push(makeEntry({ description: `action ${i}` }))
      }
    })

    expect(result.current.canUndo).toBe(true)

    // After exactly 15 sequential undos the stack must be empty (evicted the
    // 5 oldest when we pushed 20 entries into a MAX_HISTORY=15 stack).
    for (let i = 0; i < 15; i++) {
      await act(async () => { await result.current.undo() })
    }

    expect(result.current.canUndo).toBe(false)
  })

  it('dismissToast clears lastAction without popping the stack', () => {
    const { result } = renderHook(() => useUndoStack())
    const entry = makeEntry()

    act(() => { result.current.push(entry) })
    expect(result.current.lastAction).not.toBeNull()

    act(() => { result.current.dismissToast() })

    expect(result.current.lastAction).toBeNull()
    expect(result.current.canUndo).toBe(true)  // stack still has the entry
  })

  it('push after dismissToast shows lastAction for the new entry', () => {
    const { result } = renderHook(() => useUndoStack())

    act(() => { result.current.push(makeEntry({ description: 'first' })) })
    act(() => { result.current.dismissToast() })
    act(() => { result.current.push(makeEntry({ description: 'second' })) })

    expect(result.current.lastAction.description).toBe('second')
  })

  it('each pushed entry gets a unique id', () => {
    const { result } = renderHook(() => useUndoStack())
    const ids = []

    // Read lastAction after each act so React has flushed the state update.
    for (let i = 0; i < 5; i++) {
      act(() => { result.current.push(makeEntry()) })
      ids.push(result.current.lastAction.id)
    }

    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(5)
  })
})
