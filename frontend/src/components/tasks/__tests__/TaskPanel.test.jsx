import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import TaskPanel from '../TaskPanel'

const baseTask = {
  id: 1, title: 'Fix the login bug', description: 'Users cannot log in',
  priority: 'high', status: 'in_progress',
  due_date: '2099-06-01', estimated_minutes: 60,
  assignee_id: null, category_id: null, recurrence: 'none',
  subtasks: [],
}

function renderPanel(overrides = {}) {
  const props = {
    open: true,
    mode: 'create',
    task: null,
    onClose: vi.fn(),
    onCreateTask: vi.fn().mockResolvedValue(undefined),
    onUpdateTask: vi.fn().mockResolvedValue(undefined),
    persons: [],
    categories: [],
    onPatchSubtask: vi.fn().mockResolvedValue(undefined),
    onAddSubtask:   vi.fn().mockResolvedValue(undefined),
    onDeleteSubtask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  return { ...render(<TaskPanel {...props} />), props }
}

// ── Heading & mode ────────────────────────────────────────────────────────────

describe('TaskPanel — heading', () => {
  it('shows "New Task" heading in create mode', () => {
    renderPanel({ mode: 'create' })
    expect(screen.getByText('New Task')).toBeInTheDocument()
  })

  it('shows "Edit Task" heading in edit mode', () => {
    renderPanel({ mode: 'edit', task: baseTask })
    expect(screen.getByText('Edit Task')).toBeInTheDocument()
  })
})

// ── Form initial state ────────────────────────────────────────────────────────

describe('TaskPanel — form initialisation', () => {
  it('title input is empty in create mode', () => {
    renderPanel({ mode: 'create' })
    expect(screen.getByPlaceholderText('Task title')).toHaveValue('')
  })

  it('title input is pre-filled with task title in edit mode', () => {
    renderPanel({ mode: 'edit', task: baseTask })
    expect(screen.getByPlaceholderText('Task title')).toHaveValue('Fix the login bug')
  })

  it('description textarea is pre-filled in edit mode', () => {
    renderPanel({ mode: 'edit', task: baseTask })
    expect(screen.getByPlaceholderText('Optional notes…')).toHaveValue('Users cannot log in')
  })
})

// ── Submit button ─────────────────────────────────────────────────────────────

describe('TaskPanel — submit button', () => {
  it('submit button says "Create Task" in create mode', () => {
    renderPanel({ mode: 'create' })
    expect(screen.getByText('Create Task')).toBeInTheDocument()
  })

  it('submit button says "Save Changes" in edit mode', () => {
    renderPanel({ mode: 'edit', task: baseTask })
    expect(screen.getByText('Save Changes')).toBeInTheDocument()
  })

  it('submit button is disabled when title is empty', () => {
    renderPanel({ mode: 'create' })
    const btn = screen.getByText('Create Task').closest('button')
    expect(btn).toBeDisabled()
  })

  it('submit button is enabled once a title is typed', () => {
    renderPanel({ mode: 'create' })
    fireEvent.change(screen.getByPlaceholderText('Task title'), {
      target: { value: 'New task' },
    })
    const btn = screen.getByText('Create Task').closest('button')
    expect(btn).not.toBeDisabled()
  })

  it('submit button is disabled when title is only whitespace', () => {
    renderPanel({ mode: 'create' })
    fireEvent.change(screen.getByPlaceholderText('Task title'), {
      target: { value: '   ' },
    })
    const btn = screen.getByText('Create Task').closest('button')
    expect(btn).toBeDisabled()
  })
})

// ── Create flow ───────────────────────────────────────────────────────────────

describe('TaskPanel — create flow', () => {
  it('calls onCreateTask with trimmed title when Create Task is clicked', async () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'create', onCreateTask })

    fireEvent.change(screen.getByPlaceholderText('Task title'), {
      target: { value: '  Buy milk  ' },
    })
    fireEvent.click(screen.getByText('Create Task'))

    expect(onCreateTask).toHaveBeenCalledOnce()
    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Buy milk' })
    )
  })

  it('calls onCreateTask with correct priority from buttons', async () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'create', onCreateTask })

    fireEvent.change(screen.getByPlaceholderText('Task title'), {
      target: { value: 'Test' },
    })
    // Click the "High" priority button
    fireEvent.click(screen.getByText('High'))
    fireEvent.click(screen.getByText('Create Task'))

    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'high' })
    )
  })

  it('calls onCreateTask with null for blank optional fields', async () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'create', onCreateTask })

    fireEvent.change(screen.getByPlaceholderText('Task title'), {
      target: { value: 'Test' },
    })
    fireEvent.click(screen.getByText('Create Task'))

    const payload = onCreateTask.mock.calls[0][0]
    expect(payload.description).toBeNull()
    expect(payload.assignee_id).toBeNull()
    expect(payload.category_id).toBeNull()
    expect(payload.estimated_minutes).toBeNull()
  })

  it('pressing Enter in the title field calls onCreateTask', async () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'create', onCreateTask })

    const titleInput = screen.getByPlaceholderText('Task title')
    fireEvent.change(titleInput, { target: { value: 'Quick task' } })
    fireEvent.keyDown(titleInput, { key: 'Enter' })

    expect(onCreateTask).toHaveBeenCalledOnce()
  })

  it('pressing Enter in the estimated minutes field calls onCreateTask', async () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'create', onCreateTask })

    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Quick task' } })
    const minutesInput = screen.getByPlaceholderText('—')
    fireEvent.change(minutesInput, { target: { value: '30' } })
    fireEvent.keyDown(minutesInput, { key: 'Enter' })

    expect(onCreateTask).toHaveBeenCalledOnce()
  })

  it('pressing Enter in the description textarea does NOT call onCreateTask', async () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'create', onCreateTask })

    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Quick task' } })
    const textarea = screen.getByPlaceholderText('Optional notes…')
    fireEvent.change(textarea, { target: { value: 'Some notes' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onCreateTask).not.toHaveBeenCalled()
  })
})

// ── Edit flow ─────────────────────────────────────────────────────────────────

describe('TaskPanel — edit flow', () => {
  it('calls onUpdateTask with task id and updated payload', async () => {
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'edit', task: baseTask, onUpdateTask })

    fireEvent.change(screen.getByPlaceholderText('Task title'), {
      target: { value: 'Fixed the login bug' },
    })
    fireEvent.click(screen.getByText('Save Changes'))

    expect(onUpdateTask).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ title: 'Fixed the login bug' })
    )
  })
})

// ── Close behaviour ───────────────────────────────────────────────────────────

describe('TaskPanel — close behaviour', () => {
  it('Cancel button calls onClose', () => {
    const onClose = vi.fn()
    renderPanel({ onClose })
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape key calls onClose when panel is open', () => {
    const onClose = vi.fn()
    renderPanel({ open: true, onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('header ✕ button calls onClose', () => {
    const onClose = vi.fn()
    renderPanel({ onClose })
    // The header close button has text "✕" and is inside the header
    const header = screen.getByText('New Task').closest('div')
    fireEvent.click(within(header).getByText('✕'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ── Subtasks section ──────────────────────────────────────────────────────────

describe('TaskPanel — subtasks section', () => {
  it('subtasks section is hidden in create mode', () => {
    renderPanel({ mode: 'create' })
    expect(screen.queryByText('Subtasks')).not.toBeInTheDocument()
  })

  it('subtasks section is visible in edit mode', () => {
    renderPanel({ mode: 'edit', task: baseTask })
    expect(screen.getByText('Subtasks')).toBeInTheDocument()
  })

  it('renders existing subtask titles in edit mode', () => {
    const task = {
      ...baseTask,
      subtasks: [
        { id: 10, title: 'Write tests', status: 'done', order: 0, due_date: null },
        { id: 11, title: 'Review PR',   status: 'todo', order: 1, due_date: null },
      ],
    }
    renderPanel({ mode: 'edit', task })
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('Review PR')).toBeInTheDocument()
  })

  it('shows done/total subtask count', () => {
    const task = {
      ...baseTask,
      subtasks: [
        { id: 10, title: 'A', status: 'done', order: 0, due_date: null },
        { id: 11, title: 'B', status: 'todo', order: 1, due_date: null },
      ],
    }
    renderPanel({ mode: 'edit', task })
    expect(screen.getByText('1/2 done')).toBeInTheDocument()
  })

  it('Add subtask button is disabled when input is empty', () => {
    renderPanel({ mode: 'edit', task: baseTask })
    const addBtn = screen.getByText('Add').closest('button')
    expect(addBtn).toBeDisabled()
  })

  it('pressing Enter in the add-subtask input calls onAddSubtask', () => {
    const onAddSubtask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'edit', task: baseTask, onAddSubtask })

    const input = screen.getByPlaceholderText('Add subtask…')
    fireEvent.change(input, { target: { value: 'Write docs' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAddSubtask).toHaveBeenCalledWith(1, 'Write docs')
  })
})

// ── Priority buttons ──────────────────────────────────────────────────────────

describe('TaskPanel — priority buttons', () => {
  it('default priority is Medium in create mode', () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'create', onCreateTask })
    fireEvent.change(screen.getByPlaceholderText('Task title'), {
      target: { value: 'Test' },
    })
    fireEvent.click(screen.getByText('Create Task'))
    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'medium' })
    )
  })

  it('clicking Low button updates priority to low', async () => {
    const onCreateTask = vi.fn().mockResolvedValue(undefined)
    renderPanel({ mode: 'create', onCreateTask })
    fireEvent.change(screen.getByPlaceholderText('Task title'), {
      target: { value: 'Test' },
    })
    fireEvent.click(screen.getByText('Low'))
    fireEvent.click(screen.getByText('Create Task'))
    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'low' })
    )
  })
})
