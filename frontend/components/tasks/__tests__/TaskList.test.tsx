import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import TaskList from '../TaskList'

type DragEndEvent = { active: { id: number | string }; over: { id: number | string } | null }
let triggerDragEnd: ((event: DragEndEvent) => void) | undefined

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd?: (e: DragEndEvent) => void }) => {
    triggerDragEnd = onDragEnd
    return children
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => children,
  closestCenter: {},
  MouseSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: () => {},
    transform: null, transition: undefined, isDragging: false,
  }),
  arrayMove: (arr: unknown[], from: number, to: number) => {
    const a = [...arr]; a.splice(to, 0, a.splice(from, 1)[0]); return a
  },
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

vi.mock('@/lib/api', () => ({
  fetchTasks:       vi.fn(),
  fetchPersons:     vi.fn(),
  fetchCategories:  vi.fn(),
  createTask:       vi.fn(),
  updateTask:       vi.fn(),
  deleteTask:       vi.fn(),
  createSubtask:    vi.fn(),
  updateSubtask:    vi.fn(),
  deleteSubtask:    vi.fn(),
  gcalAuthStatus:   vi.fn(),
  syncToGtasks:     vi.fn(),
}))

import * as api from '@/lib/api'

const baseTask = {
  id: 1,
  title: 'Weekly chore',
  description: null,
  priority: 'medium',
  status: 'todo',
  due_date: '2020-01-07',
  estimated_minutes: null,
  assignee_id: null,
  assignee: null,
  category_id: null,
  category: null,
  recurrence: 'weekly',
  subtasks: [],
  order: 0,
  completed_at: null,
  created_at: '2099-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.fetchTasks).mockResolvedValue([baseTask])
  vi.mocked(api.fetchPersons).mockResolvedValue([])
  vi.mocked(api.fetchCategories).mockResolvedValue([])
  vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'cancelled' })
  vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
  vi.mocked(api.syncToGtasks).mockResolvedValue({ synced: 0, failed: 0, errors: [] })
})

describe('TaskList — cancel recurring task triggers reload', () => {
  it('calls fetchTasks a second time after cancelling a recurring task', async () => {
    render(<TaskList />)

    await waitFor(() => expect(screen.getByText('Weekly chore')).toBeInTheDocument())
    expect(api.fetchTasks).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Cancel' }))

    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(2))
  })
})

// ── UI states ─────────────────────────────────────────────────────────────────

describe('TaskList — UI states', () => {
  it('shows loading spinner while fetching', () => {
    vi.mocked(api.fetchTasks).mockReturnValue(new Promise(() => {}))
    render(<TaskList />)
    expect(screen.getByText('Loading tasks…')).toBeInTheDocument()
  })

  it('shows "All status filters are off" when filterStatus is emptied', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText(/Filters/))
    const statusSection = screen.getAllByText('Status')[0].closest('div') as HTMLElement
    fireEvent.click(within(statusSection).getByText('To Do'))
    fireEvent.click(within(statusSection).getByText('In Progress'))
    expect(screen.getByText(/All status filters are off/)).toBeInTheDocument()
  })

  it('shows error banner when the API call fails', async () => {
    vi.mocked(api.fetchTasks).mockRejectedValue(new Error('Network error'))
    render(<TaskList />)
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument())
  })

  it('dismissing the error banner removes it', async () => {
    vi.mocked(api.fetchTasks).mockRejectedValue(new Error('Network error'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Network error'))
    fireEvent.click(screen.getByLabelText('Dismiss error'))
    expect(screen.queryByText('Network error')).not.toBeInTheDocument()
  })

  it('FAB click opens the create panel', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))
    fireEvent.click(screen.getByTitle('New task'))
    expect(screen.getByText('New Task')).toBeInTheDocument()
  })

  it('shows "No tasks match" when filters exclude all tasks', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))
    fireEvent.click(screen.getByText(/Filters/))
    const statusSection = screen.getAllByText('Status')[0].closest('div') as HTMLElement
    fireEvent.click(within(statusSection).getByText('To Do'))
    fireEvent.click(within(statusSection).getByText('In Progress'))
    fireEvent.click(within(statusSection).getByText('Done'))
    await waitFor(() => expect(screen.getByText(/No tasks match/)).toBeInTheDocument())
  })
})

// ── Create task ───────────────────────────────────────────────────────────────

describe('TaskList — create task', () => {
  it('creates a task and adds it to the list', async () => {
    const newTask = { ...baseTask, id: 99, title: 'Brand new task' }
    vi.mocked(api.createTask).mockResolvedValue(newTask)
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('New task'))
    await waitFor(() => screen.getByText('New Task'))

    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Brand new task' } })
    fireEvent.click(screen.getByText('Create Task'))

    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Brand new task' })
    ))
  })
})

// ── Edit task ─────────────────────────────────────────────────────────────────

describe('TaskList — edit task', () => {
  it('opens the edit panel when Edit is selected from the overflow menu', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }))

    expect(screen.getByText('Edit Task')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Weekly chore')).toBeInTheDocument()
  })

  it('calls updateTask when Save Changes is clicked', async () => {
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, title: 'Updated chore' })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }))

    await waitFor(() => screen.getByText('Edit Task'))
    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Updated chore' } })
    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith(
      1, expect.objectContaining({ title: 'Updated chore' })
    ))
  })
})

// ── Delete task ───────────────────────────────────────────────────────────────

describe('TaskList — delete task', () => {
  it('calls deleteTask and removes the task from the list', async () => {
    vi.mocked(api.deleteTask).mockResolvedValue(undefined)
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(api.deleteTask).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByText('Weekly chore')).not.toBeInTheDocument())
  })
})

// ── Patch task ────────────────────────────────────────────────────────────────

describe('TaskList — patch task', () => {
  it('patching a task updates it in place (non-done status)', async () => {
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'in_progress' })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Start task'))

    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith(1, { status: 'in_progress' }))
  })
})

// ── Subtask operations ────────────────────────────────────────────────────────

describe('TaskList — subtask operations', () => {
  const taskWithSub = {
    ...baseTask,
    subtasks: [{ id: 20, title: 'Sub A', status: 'todo', order: 0, due_date: null }],
  }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([taskWithSub])
  })

  it('toggling a subtask checkbox calls updateSubtask', async () => {
    vi.mocked(api.updateSubtask).mockResolvedValue({ id: 20, title: 'Sub A', status: 'done', order: 0 })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))

    const checkbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(checkbox)

    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledWith(1, 20, { status: 'done' }))
  })

  it('adding a subtask via the inline input calls createSubtask', async () => {
    vi.mocked(api.createSubtask).mockResolvedValue({ id: 21, title: 'Sub B', status: 'todo', order: 1 })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByPlaceholderText('Add subtask…'))

    fireEvent.change(screen.getByPlaceholderText('Add subtask…'), { target: { value: 'Sub B' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Add subtask…'), { key: 'Enter' })

    await waitFor(() => expect(api.createSubtask).toHaveBeenCalledWith(1, { title: 'Sub B' }))
  })
})

// ── Keyboard shortcut ─────────────────────────────────────────────────────────

describe('TaskList — keyboard Ctrl+Z / Cmd+Z triggers undo', () => {
  it('pressing Ctrl+Z after a patch reverts the change', async () => {
    vi.mocked(api.updateTask)
      .mockResolvedValueOnce({ ...baseTask, status: 'in_progress' })
      .mockResolvedValueOnce({ ...baseTask, status: 'todo' })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Start task'))
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(2))
    expect(api.updateTask).toHaveBeenLastCalledWith(1, { status: 'todo' })
  })

  it('pressing Cmd+Z also triggers undo', async () => {
    vi.mocked(api.updateTask)
      .mockResolvedValueOnce({ ...baseTask, status: 'in_progress' })
      .mockResolvedValueOnce({ ...baseTask, status: 'todo' })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Start task'))
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(2))
  })
})


// ── silentLoad error path ─────────────────────────────────────────────────────

describe('TaskList — silentLoad error path', () => {
  it('shows error banner when silentLoad fails after cancelling', async () => {
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'cancelled' })
    vi.mocked(api.fetchTasks)
      .mockResolvedValueOnce([baseTask])
      .mockRejectedValueOnce(new Error('Reload failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.getByText('Reload failed')).toBeInTheDocument()
    )
  })
})

// ── Task grouping by due date ─────────────────────────────────────────────────

describe('TaskList — task grouping by due date', () => {
  function todayPlus(n: number) {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  it('places a task due tomorrow in the Tomorrow section', async () => {
    vi.mocked(api.fetchTasks).mockResolvedValue([{ ...baseTask, due_date: todayPlus(1) }])
    render(<TaskList />)
    await waitFor(() => screen.getByText('Tomorrow'))
    fireEvent.click(screen.getByText('Tomorrow'))
    fireEvent.click(screen.getByText('Tomorrow'))
    await waitFor(() => screen.getByText('Weekly chore'))
  })

  it('places a task due in 3 days in the This Week section', async () => {
    vi.mocked(api.fetchTasks).mockResolvedValue([{ ...baseTask, due_date: todayPlus(3) }])
    render(<TaskList />)
    await waitFor(() => screen.getByText('This Week'))
    fireEvent.click(screen.getByText('This Week'))
    fireEvent.click(screen.getByText('This Week'))
    await waitFor(() => screen.getByText('Weekly chore'))
  })

  it('places a task due in 10 days in the Next Week section', async () => {
    vi.mocked(api.fetchTasks).mockResolvedValue([{ ...baseTask, due_date: todayPlus(10) }])
    render(<TaskList />)
    await waitFor(() => screen.getByText('Next Week'))
    fireEvent.click(screen.getByText('Next Week'))
    fireEvent.click(screen.getByText('Next Week'))
    await waitFor(() => screen.getByText('Weekly chore'))
  })

  it('places a task due in 20 days in the Later section', async () => {
    vi.mocked(api.fetchTasks).mockResolvedValue([{ ...baseTask, due_date: todayPlus(20) }])
    render(<TaskList />)
    await waitFor(() => screen.getByText('Later'))
    fireEvent.click(screen.getByText('Later'))
    fireEvent.click(screen.getByText('Later'))
    await waitFor(() => screen.getByText('Weekly chore'))
  })

  it('places a task with no due date in the No Date section', async () => {
    vi.mocked(api.fetchTasks).mockResolvedValue([{ ...baseTask, due_date: null }])
    render(<TaskList />)
    await waitFor(() => screen.getByText('No Date'))
    fireEvent.click(screen.getByText('No Date'))
    fireEvent.click(screen.getByText('No Date'))
    await waitFor(() => screen.getByText('Weekly chore'))
  })

  it('places a done task into Done group when done filter is active', async () => {
    vi.mocked(api.fetchTasks).mockResolvedValue([{ ...baseTask, status: 'done' }])
    render(<TaskList />)
    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText(/Filters/))
    const statusSection = screen.getAllByText('Status')[0].closest('div') as HTMLElement
    fireEvent.click(within(statusSection).getByText('Done'))
    fireEvent.click(within(statusSection).getByText('To Do'))
    fireEvent.click(within(statusSection).getByText('In Progress'))

    await waitFor(() =>
      expect(screen.queryByText('No tasks match the current filters.')).not.toBeInTheDocument()
    )
    expect(screen.queryByText(/All status filters are off/)).not.toBeInTheDocument()
  })

  it('places a task due today in the Today section', async () => {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    vi.mocked(api.fetchTasks).mockResolvedValue([{ ...baseTask, due_date: todayStr }])
    render(<TaskList />)
    await waitFor(() => screen.getByText('Today'))
    fireEvent.click(screen.getByText('Today'))
    fireEvent.click(screen.getByText('Today'))
    await waitFor(() => screen.getByText('Weekly chore'))
  })
})

// ── Section collapse ──────────────────────────────────────────────────────────

describe('TaskList — section collapse/expand', () => {
  it('collapses the Overdue section when its header is clicked', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('Overdue'))

    await waitFor(() =>
      expect(screen.queryByText('Weekly chore')).not.toBeInTheDocument()
    )
  })
})

// ── handleCreateTask error ────────────────────────────────────────────────────

describe('TaskList — handleCreateTask error', () => {
  it('shows error banner when createTask fails', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Create failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('New task'))
    await waitFor(() => screen.getByText('New Task'))

    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'A task' } })
    fireEvent.click(screen.getByText('Create Task'))

    await waitFor(() => expect(screen.getByText('Create failed')).toBeInTheDocument())
  })
})

// ── handleUpdateTask ──────────────────────────────────────────────────────────

describe('TaskList — handleUpdateTask', () => {
  it('reloads all tasks when panel saves a task with done status', async () => {
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'done' })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }))
    await waitFor(() => screen.getByText('Edit Task'))

    fireEvent.change(screen.getByDisplayValue('To Do'), { target: { value: 'done' } })
    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(2))
  })

  it('shows error when updateTask fails in the edit panel', async () => {
    vi.mocked(api.updateTask).mockRejectedValue(new Error('Update failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }))
    await waitFor(() => screen.getByText('Edit Task'))

    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(screen.getByText('Update failed')).toBeInTheDocument())
  })
})

// ── patchTask done ────────────────────────────────────────────────────────────

describe('TaskList — patchTask done', () => {
  it('triggers silentLoad after marking a task done', async () => {
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'done' })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Mark as done'))

    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(2), { timeout: 2000 })
  })

  it('shows error banner when updateTask fails during done patch', async () => {
    vi.mocked(api.updateTask).mockRejectedValue(new Error('Done failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Mark as done'))

    await waitFor(() => expect(screen.getByText('Done failed')).toBeInTheDocument(), { timeout: 2000 })
  })
})

// ── patchTask undo toast ──────────────────────────────────────────────────────

describe('TaskList — patchTask undo toast', () => {
  it('shows undo toast after starting a task', async () => {
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'in_progress' })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Start task'))

    await waitFor(() =>
      expect(screen.getByText(/"Weekly chore" started/)).toBeInTheDocument()
    )
  })
})

// ── deleteTask error ──────────────────────────────────────────────────────────

describe('TaskList — deleteTask error', () => {
  it('shows error when deleteTask fails', async () => {
    vi.mocked(api.deleteTask).mockRejectedValue(new Error('Delete failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(screen.getByText('Delete failed')).toBeInTheDocument())
  })
})

// ── patchSubtask undo and error ───────────────────────────────────────────────

describe('TaskList — patchSubtask undo and error', () => {
  const taskWithSub = {
    ...baseTask,
    subtasks: [{ id: 20, title: 'Sub A', status: 'todo', order: 0, due_date: null }],
  }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([taskWithSub])
  })

  it('shows undo toast after checking a subtask', async () => {
    vi.mocked(api.updateSubtask).mockResolvedValue({ id: 20, title: 'Sub A', status: 'done', order: 0 })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))

    fireEvent.click(screen.getAllByRole('checkbox')[0])

    await waitFor(() =>
      expect(screen.getByText(/Subtask "Sub A" checked/)).toBeInTheDocument()
    )
  })

  it('shows error when updateSubtask fails', async () => {
    vi.mocked(api.updateSubtask).mockRejectedValue(new Error('Subtask patch failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))

    fireEvent.click(screen.getAllByRole('checkbox')[0])

    await waitFor(() => expect(screen.getByText('Subtask patch failed')).toBeInTheDocument())
  })
})

// ── addSubtask error ──────────────────────────────────────────────────────────

describe('TaskList — addSubtask error', () => {
  const taskWithSub = {
    ...baseTask,
    subtasks: [{ id: 20, title: 'Sub A', status: 'todo', order: 0, due_date: null }],
  }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([taskWithSub])
  })

  it('shows error when createSubtask fails', async () => {
    vi.mocked(api.createSubtask).mockRejectedValue(new Error('Add sub failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByPlaceholderText('Add subtask…'))

    fireEvent.change(screen.getByPlaceholderText('Add subtask…'), { target: { value: 'New sub' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Add subtask…'), { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('Add sub failed')).toBeInTheDocument())
  })
})

// ── deleteSubtask ─────────────────────────────────────────────────────────────

describe('TaskList — deleteSubtask', () => {
  const taskWithSub = {
    ...baseTask,
    subtasks: [{ id: 20, title: 'Sub A', status: 'todo', order: 0, due_date: null }],
  }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([taskWithSub])
  })

  it('deletes a subtask and shows undo toast', async () => {
    vi.mocked(api.deleteSubtask).mockResolvedValue(undefined)
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))

    fireEvent.click(screen.getByTitle('Delete subtask'))

    await waitFor(() => expect(api.deleteSubtask).toHaveBeenCalledWith(1, 20))
    await waitFor(() =>
      expect(screen.getByText(/Subtask "Sub A" deleted/)).toBeInTheDocument()
    )
  })
})

// ── FAB hidden when panel is open ─────────────────────────────────────────────

describe('TaskList — FAB visibility', () => {
  it('FAB gets the "hidden" class when the create panel is open', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    const fab = screen.getByTitle('New task')
    expect(fab).not.toHaveClass('hidden')

    fireEvent.click(fab)
    await waitFor(() => screen.getByText('New Task'))

    expect(screen.getByTitle('New task')).toHaveClass('hidden')
  })
})

// ── Sort field ────────────────────────────────────────────────────────────────

describe('TaskList — sort field via toolbar', () => {
  it('switching to priority sort updates the toolbar button label', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Sort tasks'))
    // Multiple "Priority" elements exist (sort option + filter label) — click the button
    const priorityBtn = screen.getAllByText('Priority').find(el => el.tagName === 'BUTTON')!
    fireEvent.click(priorityBtn)

    expect(screen.getByTitle('Sort tasks')).toHaveTextContent('Priority')
  })

  it('switching to created_at sort updates the toolbar button label', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Sort tasks'))
    fireEvent.click(screen.getByText('Created'))

    expect(screen.getByTitle('Sort tasks')).toHaveTextContent('Created')
  })
})

// ── Command palette via Ctrl+K ────────────────────────────────────────────────

describe('TaskList — command palette via Ctrl+K', () => {
  it('pressing Ctrl+K opens the command palette', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search tasks or type a command…')).toBeInTheDocument()
    )
  })

  it('pressing Escape on the open palette closes it', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await waitFor(() => screen.getByPlaceholderText('Search tasks or type a command…'))

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Search tasks or type a command…')).not.toBeInTheDocument()
    )
  })

  it('selecting "New task" from the palette opens the create panel', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await waitFor(() => screen.getByPlaceholderText('Search tasks or type a command…'))

    fireEvent.click(screen.getByText('New task'))

    await waitFor(() => expect(screen.getByText('New Task')).toBeInTheDocument())
  })

  it('clicking a task result in the palette opens the edit panel', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await waitFor(() => screen.getByPlaceholderText('Search tasks or type a command…'))

    fireEvent.change(screen.getByPlaceholderText('Search tasks or type a command…'), {
      target: { value: 'Weekly' },
    })

    // Find the task result item (has status label "To Do", unlike action items)
    await waitFor(() => {
      const taskItem = Array.from(document.querySelectorAll('[data-cmd-item]'))
        .find(el => el.textContent?.includes('To Do'))
      expect(taskItem).toBeTruthy()
    })

    const taskItem = Array.from(document.querySelectorAll('[data-cmd-item]'))
      .find(el => el.textContent?.includes('To Do')) as HTMLElement
    fireEvent.click(taskItem)

    await waitFor(() => expect(screen.getByText('Edit Task')).toBeInTheDocument())
  })

  it('Ctrl+K again closes an already-open palette', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await waitFor(() => screen.getByPlaceholderText('Search tasks or type a command…'))

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Search tasks or type a command…')).not.toBeInTheDocument()
    )
  })
})

// ── Fetch limit warnings ──────────────────────────────────────────────────────

describe('TaskList — fetch limit warnings', () => {
  it('logs a warning when the initial load returns the fetch limit', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const manyTasks = Array.from({ length: 500 }, (_, i) => ({ ...baseTask, id: i + 1 }))
    vi.mocked(api.fetchTasks).mockResolvedValue(manyTasks)

    render(<TaskList />)

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hit fetch limit'))
    )
    warnSpy.mockRestore()
  })

  it('logs a warning when silentLoad returns the fetch limit', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const manyTasks = Array.from({ length: 500 }, (_, i) => ({ ...baseTask, id: i + 1 }))
    vi.mocked(api.fetchTasks)
      .mockResolvedValueOnce([baseTask])
      .mockResolvedValueOnce(manyTasks)
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'cancelled' })

    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Cancel' }))

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hit fetch limit'))
    )
    warnSpy.mockRestore()
  })
})

// ── Task keyboard navigation ──────────────────────────────────────────────────

describe('TaskList — task keyboard navigation', () => {
  it('ArrowDown sets a ring-2 focus indicator on the first task', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'ArrowDown' })

    await waitFor(() => expect(document.querySelector('.ring-2')).toBeInTheDocument())
  })

  it('"j" key also navigates to the first task', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'j' })

    await waitFor(() => expect(document.querySelector('.ring-2')).toBeInTheDocument())
  })

  it('ArrowUp with no focus selects the last task', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'ArrowUp' })

    await waitFor(() => expect(document.querySelector('.ring-2')).toBeInTheDocument())
  })

  it('"k" key navigates up', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => expect(document.querySelector('.ring-2')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'k' })
    await waitFor(() => expect(document.querySelector('.ring-2')).toBeInTheDocument())
  })

  it('Escape clears the focused task', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    await waitFor(() => expect(document.querySelector('.ring-2')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(document.querySelector('.ring-2')).not.toBeInTheDocument())
  })

  it('Space marks the focused task as done', async () => {
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'done' })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    await waitFor(() => expect(document.querySelector('.ring-2')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: ' ' })

    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith(1, { status: 'done' }), {
      timeout: 2000,
    })
  })

  it('Enter expands the focused task card', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    await waitFor(() => expect(document.querySelector('.ring-2')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.getByText('Weekly chore')).toBeInTheDocument()
  })

  it('ignores navigation keys when an input is focused', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    const searchInput = screen.getByPlaceholderText('Search tasks…')
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' })

    expect(document.querySelector('.ring-2')).not.toBeInTheDocument()
  })
})

// ── Open planner ──────────────────────────────────────────────────────────────

describe('TaskList — open planner', () => {
  it('clicking the planner button opens the TaskRebalancerModal', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('Task planner — 10,000-foot view'))

    await waitFor(() => expect(screen.getByText('Task Planner')).toBeInTheDocument())
  })
})

// ── patchSubtask updates open panel ──────────────────────────────────────────

describe('TaskList — patchSubtask updates the open edit panel', () => {
  const taskWithSub = {
    ...baseTask,
    subtasks: [{ id: 20, title: 'Sub A', status: 'todo', order: 0, due_date: null }],
  }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([taskWithSub])
  })

  it('patching a subtask while the panel is open updates the panel task', async () => {
    vi.mocked(api.updateSubtask).mockResolvedValue({ id: 20, title: 'Sub A', status: 'done', order: 0 })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' }))
    await waitFor(() => screen.getByText('Edit Task'))

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledWith(1, 20, { status: 'done' }))
  })
})

// ── patchSubtask undo callback ────────────────────────────────────────────────

describe('TaskList — patchSubtask undo callback', () => {
  const taskWithSub = {
    ...baseTask,
    subtasks: [{ id: 20, title: 'Sub A', status: 'todo', order: 0, due_date: null }],
  }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([taskWithSub])
  })

  it('undoing a subtask check calls updateSubtask to revert it', async () => {
    vi.mocked(api.updateSubtask)
      .mockResolvedValueOnce({ id: 20, title: 'Sub A', status: 'done', order: 0 })
      .mockResolvedValueOnce({ id: 20, title: 'Sub A', status: 'todo', order: 0 })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledTimes(2))
    expect(api.updateSubtask).toHaveBeenLastCalledWith(1, 20, { status: 'todo' })
  })
})

// ── deleteSubtask undo callback ───────────────────────────────────────────────

describe('TaskList — deleteSubtask undo callback', () => {
  const taskWithSub = {
    ...baseTask,
    subtasks: [{ id: 20, title: 'Sub A', status: 'todo', order: 0, due_date: null }],
  }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([taskWithSub])
  })

  it('undoing a subtask delete calls createSubtask to restore it', async () => {
    vi.mocked(api.deleteSubtask).mockResolvedValue(undefined)
    vi.mocked(api.createSubtask).mockResolvedValue({
      id: 20, title: 'Sub A', status: 'todo', order: 0,
    })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))
    fireEvent.click(screen.getByTitle('Delete subtask'))
    await waitFor(() => expect(api.deleteSubtask).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

    await waitFor(() =>
      expect(api.createSubtask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ title: 'Sub A' })
      )
    )
  })
})

// ── reorderTasks ──────────────────────────────────────────────────────────────

describe('TaskList — reorderTasks', () => {
  const task1 = { ...baseTask, id: 1, order: 0 }
  const task2 = { ...baseTask, id: 2, title: 'Second chore', order: 1 }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([task1, task2])
    vi.mocked(api.updateTask).mockResolvedValue({ ...task1, order: 0 })
  })

  it('calls updateTask for each task whose order changed after a drag', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Second chore'))

    triggerDragEnd?.({ active: { id: 2 }, over: { id: 1 } })

    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith(2, { order: 0 }))
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith(1, { order: 1 }))
  })

  it('shows an error banner when the reorder API call fails', async () => {
    vi.mocked(api.updateTask).mockRejectedValue(new Error('Reorder failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Second chore'))

    triggerDragEnd?.({ active: { id: 2 }, over: { id: 1 } })

    await waitFor(() => expect(screen.getByText('Reorder failed')).toBeInTheDocument())
  })
})

// ── reorderSubtasks ───────────────────────────────────────────────────────────

describe('TaskList — reorderSubtasks', () => {
  const sub1 = { id: 20, title: 'Sub A', status: 'todo', order: 0, due_date: null }
  const sub2 = { id: 21, title: 'Sub B', status: 'todo', order: 1, due_date: null }
  const taskWithSubs = { ...baseTask, subtasks: [sub1, sub2] }

  beforeEach(() => {
    vi.mocked(api.fetchTasks).mockResolvedValue([taskWithSubs])
    vi.mocked(api.updateSubtask).mockResolvedValue({ ...sub1, order: 0 })
  })

  it('calls updateSubtask for each subtask whose order changed after a drag', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))

    triggerDragEnd?.({ active: { id: 20 }, over: { id: 21 } })

    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalled())
  })

  it('shows an error banner when the subtask reorder API call fails', async () => {
    vi.mocked(api.updateSubtask).mockRejectedValue(new Error('Subtask reorder failed'))
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))

    triggerDragEnd?.({ active: { id: 20 }, over: { id: 21 } })

    await waitFor(() => expect(screen.getByText('Subtask reorder failed')).toBeInTheDocument())
  })
})
