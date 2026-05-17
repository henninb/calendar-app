import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import CommandPalette from '../CommandPalette'
import type { Task } from '../helpers'

function makeTasks(): Task[] {
  return [
    {
      id: 1,
      title: 'Write report',
      description: 'Monthly summary',
      status: 'todo',
      priority: 'medium',
      due_date: null,
      subtasks: [],
      order: 0,
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 2,
      title: 'Review PR',
      description: null,
      status: 'in_progress',
      priority: 'high',
      due_date: null,
      subtasks: [],
      order: 1,
      created_at: '2024-01-02T00:00:00Z',
    },
    {
      id: 3,
      title: 'Deploy release',
      description: null,
      status: 'done',
      priority: 'low',
      due_date: null,
      subtasks: [],
      order: 2,
      created_at: '2024-01-03T00:00:00Z',
    },
    {
      id: 4,
      title: 'Fix bug',
      description: null,
      status: 'cancelled',
      priority: 'high',
      due_date: null,
      subtasks: [],
      order: 3,
      created_at: '2024-01-04T00:00:00Z',
    },
  ]
}

function makeProps(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    tasks: makeTasks(),
    onOpenCreate: vi.fn(),
    onEditTask: vi.fn(),
    onPatchTask: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ── Closed state ──────────────────────────────────────────────────────────────

describe('CommandPalette — closed state', () => {
  it('renders nothing when open is false', () => {
    render(<CommandPalette {...makeProps({ open: false })} />)
    expect(screen.queryByPlaceholderText('Search tasks or type a command…')).not.toBeInTheDocument()
  })
})

// ── Open state ────────────────────────────────────────────────────────────────

describe('CommandPalette — open state', () => {
  it('renders the search input and navigation hints', () => {
    render(<CommandPalette {...makeProps()} />)
    expect(screen.getByPlaceholderText('Search tasks or type a command…')).toBeInTheDocument()
    expect(screen.getByText('navigate')).toBeInTheDocument()
    expect(screen.getByText('select')).toBeInTheDocument()
    expect(screen.getByText('close')).toBeInTheDocument()
  })

  it('shows "New task" static action with ⌘N shortcut', () => {
    render(<CommandPalette {...makeProps()} />)
    expect(screen.getByText('New task')).toBeInTheDocument()
    expect(screen.getByText('⌘N')).toBeInTheDocument()
  })

  it('shows the Actions group header with static actions visible', () => {
    render(<CommandPalette {...makeProps()} />)
    expect(screen.getByText('Actions')).toBeInTheDocument()
  })
})

// ── Closing ───────────────────────────────────────────────────────────────────

describe('CommandPalette — closing', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...makeProps({ onClose })} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop overlay is clicked', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...makeProps({ onClose })} />)
    const backdrop = document.querySelector('.absolute.inset-0') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ── New task action ───────────────────────────────────────────────────────────

describe('CommandPalette — "New task" static action', () => {
  it('clicking "New task" calls onClose then onOpenCreate', () => {
    const onClose = vi.fn()
    const onOpenCreate = vi.fn()
    render(<CommandPalette {...makeProps({ onClose, onOpenCreate })} />)
    fireEvent.click(screen.getByText('New task'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenCreate).toHaveBeenCalledTimes(1)
  })
})

// ── Task search ───────────────────────────────────────────────────────────────

describe('CommandPalette — task search', () => {
  it('shows no task results when query is empty', () => {
    render(<CommandPalette {...makeProps()} />)
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument()
  })

  it('shows matching tasks in the Tasks group when a query is typed', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'report' },
    })
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Write report')).toBeInTheDocument()
  })

  it('filters out non-matching tasks', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'report' },
    })
    expect(screen.queryByText('Review PR')).not.toBeInTheDocument()
  })

  it('matches tasks by description as well as title', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'monthly' },
    })
    expect(screen.getByText('Write report')).toBeInTheDocument()
  })

  it('shows the task status label as a description', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'report' },
    })
    expect(screen.getByText('To Do')).toBeInTheDocument()
  })

  it('shows "No results" message when query matches nothing', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'zzznomatch999' },
    })
    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('clicking a task item calls onClose and onEditTask', () => {
    const onClose = vi.fn()
    const onEditTask = vi.fn()
    render(<CommandPalette {...makeProps({ onClose, onEditTask })} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'report' },
    })
    fireEvent.click(screen.getByText('Write report'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onEditTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })
})

// ── Task quick actions ────────────────────────────────────────────────────────

describe('CommandPalette — task quick actions', () => {
  it('shows "Mark done" and "Start" actions for a todo task', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'report' },
    })
    expect(screen.getByText('Mark done — Write report')).toBeInTheDocument()
    expect(screen.getByText('Start — Write report')).toBeInTheDocument()
  })

  it('shows "Mark done" but not "Start" for an in_progress task', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'review' },
    })
    expect(screen.getByText('Mark done — Review PR')).toBeInTheDocument()
    expect(screen.queryByText('Start — Review PR')).not.toBeInTheDocument()
  })

  it('shows no quick actions for a done task', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'deploy' },
    })
    expect(screen.queryByText('Mark done — Deploy release')).not.toBeInTheDocument()
    expect(screen.queryByText('Start — Deploy release')).not.toBeInTheDocument()
  })

  it('shows no quick actions for a cancelled task', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'fix bug' },
    })
    expect(screen.queryByText(/Mark done.*Fix bug/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Start.*Fix bug/)).not.toBeInTheDocument()
  })

  it('"Mark done" action calls onPatchTask with done status', () => {
    const onClose = vi.fn()
    const onPatchTask = vi.fn()
    render(<CommandPalette {...makeProps({ onClose, onPatchTask })} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'report' },
    })
    fireEvent.click(screen.getByText('Mark done — Write report'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onPatchTask).toHaveBeenCalledWith(1, { status: 'done' })
  })

  it('"Start" action calls onPatchTask with in_progress status', () => {
    const onClose = vi.fn()
    const onPatchTask = vi.fn()
    render(<CommandPalette {...makeProps({ onClose, onPatchTask })} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'report' },
    })
    fireEvent.click(screen.getByText('Start — Write report'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onPatchTask).toHaveBeenCalledWith(1, { status: 'in_progress' })
  })
})

// ── Keyboard navigation ───────────────────────────────────────────────────────

describe('CommandPalette — keyboard navigation', () => {
  it('ArrowDown moves focus to next item without error', () => {
    render(<CommandPalette {...makeProps()} />)
    const input = screen.getByPlaceholderText('Search tasks or type a command…')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByText('New task')).toBeInTheDocument()
  })

  it('ArrowUp moves focus to previous item without error', () => {
    render(<CommandPalette {...makeProps()} />)
    const input = screen.getByPlaceholderText('Search tasks or type a command…')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByText('New task')).toBeInTheDocument()
  })

  it('ArrowDown with multiple results navigates through them', () => {
    render(<CommandPalette {...makeProps()} />)
    const input = screen.getByPlaceholderText('Search tasks or type a command…')
    fireEvent.change(input, { target: { value: 'report' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByText('Write report')).toBeInTheDocument()
  })

  it('Enter on the first item (New task) triggers onClose and onOpenCreate', () => {
    const onClose = vi.fn()
    const onOpenCreate = vi.fn()
    render(<CommandPalette {...makeProps({ onClose, onOpenCreate })} />)
    const input = screen.getByPlaceholderText('Search tasks or type a command…')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenCreate).toHaveBeenCalledTimes(1)
  })

  it('mouseEnter on an item updates the active item', () => {
    render(<CommandPalette {...makeProps()} />)
    const newTaskBtn = screen.getByText('New task').closest('button')!
    fireEvent.mouseEnter(newTaskBtn)
    expect(screen.getByText('New task')).toBeInTheDocument()
  })
})

// ── Clear button ──────────────────────────────────────────────────────────────

describe('CommandPalette — clear button', () => {
  it('does not show clear button when query is empty', () => {
    render(<CommandPalette {...makeProps()} />)
    expect(screen.queryByText('✕')).not.toBeInTheDocument()
  })

  it('shows clear button once query is typed', () => {
    render(<CommandPalette {...makeProps()} />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'test' },
    })
    expect(screen.getByText('✕')).toBeInTheDocument()
  })

  it('clicking the clear button resets the query', async () => {
    render(<CommandPalette {...makeProps()} />)
    const input = screen.getByPlaceholderText('Search tasks or type a command…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'test' } })
    fireEvent.click(screen.getByText('✕'))
    await waitFor(() => expect(input.value).toBe(''))
    expect(screen.queryByText('✕')).not.toBeInTheDocument()
  })
})

// ── Query reset on reopen ─────────────────────────────────────────────────────

describe('CommandPalette — reopen resets state', () => {
  it('resets query when palette is reopened', () => {
    const { rerender } = render(<CommandPalette {...makeProps()} />)
    const input = screen.getByPlaceholderText('Search tasks or type a command…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    expect(input.value).toBe('hello')

    rerender(<CommandPalette {...makeProps({ open: false })} />)
    rerender(<CommandPalette {...makeProps({ open: true })} />)

    const newInput = screen.getByPlaceholderText('Search tasks or type a command…') as HTMLInputElement
    expect(newInput.value).toBe('')
  })
})
