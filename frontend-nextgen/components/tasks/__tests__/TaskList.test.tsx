import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import TaskList from '../TaskList'

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  closestCenter: {},
  MouseSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
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
  fetchTasks:      vi.fn(),
  fetchPersons:    vi.fn(),
  fetchCategories: vi.fn(),
  createTask:      vi.fn(),
  updateTask:      vi.fn(),
  deleteTask:      vi.fn(),
  createSubtask:   vi.fn(),
  updateSubtask:   vi.fn(),
  deleteSubtask:   vi.fn(),
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
  vi.clearAllMocks()
  vi.mocked(api.fetchTasks).mockResolvedValue([baseTask])
  vi.mocked(api.fetchPersons).mockResolvedValue([])
  vi.mocked(api.fetchCategories).mockResolvedValue([])
  vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'cancelled' })
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

// ── Fetch-limit warning ───────────────────────────────────────────────────────

describe('TaskList — fetch-limit warning', () => {
  it('shows the fetch-limit banner when 500 tasks are loaded', async () => {
    const manyTasks = Array.from({ length: 500 }, (_, i) => ({
      ...baseTask,
      id: i + 1,
      created_at: `2099-01-01T${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor((i % 3600) / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
    }))
    vi.mocked(api.fetchTasks).mockResolvedValue(manyTasks)
    render(<TaskList />)
    await waitFor(() =>
      expect(screen.getByText(/Showing the first 500 tasks/)).toBeInTheDocument()
    )
  })

  it('logs a warning when silentLoad returns 500 tasks', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const manyTasks = Array.from({ length: 500 }, (_, i) => ({
      ...baseTask, id: i + 1,
    }))
    vi.mocked(api.updateTask).mockResolvedValue({ ...baseTask, status: 'cancelled' })
    vi.mocked(api.fetchTasks)
      .mockResolvedValueOnce([baseTask])
      .mockResolvedValueOnce(manyTasks)

    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Cancel' }))

    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(2))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hit fetch limit'))
    warnSpy.mockRestore()
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
