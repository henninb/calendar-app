import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import UndoToast from '../UndoToast'

const TOAST_MS = 8000
const FADE_MS  = 300

function makeAction(overrides = {}) {
  return { id: Date.now(), description: 'Task updated', ...overrides }
}

describe('UndoToast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders nothing when action is null and toast has not been shown', () => {
    const { container } = render(
      <UndoToast action={null} onUndo={vi.fn()} onDismiss={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the action description when an action is provided', () => {
    render(
      <UndoToast
        action={makeAction({ description: '"Buy milk" marked as done' })}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText('"Buy milk" marked as done')).toBeInTheDocument()
  })

  it('renders an Undo button and a Dismiss button', () => {
    render(
      <UndoToast action={makeAction()} onUndo={vi.fn()} onDismiss={vi.fn()} />
    )
    expect(screen.getByText('↩ Undo')).toBeInTheDocument()
    expect(screen.getByLabelText('Dismiss')).toBeInTheDocument()
  })

  it('calls onUndo immediately when the Undo button is clicked', () => {
    const onUndo = vi.fn()
    render(<UndoToast action={makeAction()} onUndo={onUndo} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByText('↩ Undo'))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('calls onDismiss after FADE_MS when the dismiss (✕) button is clicked', () => {
    const onDismiss = vi.fn()
    render(<UndoToast action={makeAction()} onUndo={vi.fn()} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(onDismiss).not.toHaveBeenCalled()       // not called synchronously

    act(() => { vi.advanceTimersByTime(FADE_MS) })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('auto-dismisses after TOAST_MS + FADE_MS', () => {
    const onDismiss = vi.fn()
    render(<UndoToast action={makeAction()} onUndo={vi.fn()} onDismiss={onDismiss} />)

    act(() => { vi.advanceTimersByTime(TOAST_MS + FADE_MS) })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('does NOT auto-dismiss before TOAST_MS has elapsed', () => {
    const onDismiss = vi.fn()
    render(<UndoToast action={makeAction()} onUndo={vi.fn()} onDismiss={onDismiss} />)

    act(() => { vi.advanceTimersByTime(TOAST_MS - 1) })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('resets the auto-dismiss countdown when a new action arrives', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(
      <UndoToast action={makeAction({ id: 1 })} onUndo={vi.fn()} onDismiss={onDismiss} />
    )

    // Advance almost to expiry
    act(() => { vi.advanceTimersByTime(TOAST_MS - 100) })
    expect(onDismiss).not.toHaveBeenCalled()

    // New action arrives — should restart the full countdown
    rerender(
      <UndoToast action={makeAction({ id: 2 })} onUndo={vi.fn()} onDismiss={onDismiss} />
    )

    // Another TOAST_MS - 100 ms elapses — should still not dismiss
    act(() => { vi.advanceTimersByTime(TOAST_MS - 100) })
    expect(onDismiss).not.toHaveBeenCalled()

    // Advance past the new timer + fade
    act(() => { vi.advanceTimersByTime(200 + FADE_MS) })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('has role="status" and aria-live="polite" for accessibility', () => {
    render(<UndoToast action={makeAction()} onUndo={vi.fn()} onDismiss={vi.fn()} />)
    const toast = screen.getByRole('status')
    expect(toast).toHaveAttribute('aria-live', 'polite')
  })
})
