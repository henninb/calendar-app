import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import TaskList from '../TaskList'

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }) => children,
  closestCenter: {},
  MouseSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }) => children,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: () => {},
    transform: null, transition: undefined, isDragging: false,
  }),
  arrayMove: (arr, from, to) => {
    const a = [...arr]; a.splice(to, 0, a.splice(from, 1)[0]); return a
  },
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

vi.mock('../../../api', () => ({
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

import * as api from '../../../api'

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
  api.fetchTasks.mockResolvedValue([baseTask])
  api.fetchPersons.mockResolvedValue([])
  api.fetchCategories.mockResolvedValue([])
  api.updateTask.mockResolvedValue({ ...baseTask, status: 'cancelled' })
})

describe('TaskList — cancel recurring task triggers reload', () => {
  it('calls fetchTasks a second time after cancelling a recurring task', async () => {
    render(<TaskList />)

    // Wait for the initial load to complete and the task to appear
    await waitFor(() => expect(screen.getByText('Weekly chore')).toBeInTheDocument())
    expect(api.fetchTasks).toHaveBeenCalledTimes(1)

    // Open the overflow menu and click Cancel — scope within the menu to avoid
    // the TaskPanel's Cancel button which is always present in the DOM
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Cancel' }))

    // silentLoad should fire fetchTasks a second time to pick up the spawned successor
    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(2))
  })
})

// ── UI states ─────────────────────────────────────────────────────────────────

describe('TaskList — UI states', () => {
  it('shows loading spinner while fetching', () => {
    api.fetchTasks.mockReturnValue(new Promise(() => {})) // never resolves
    render(<TaskList />)
    expect(screen.getByText('Loading tasks…')).toBeInTheDocument()
  })

  it('shows "All status filters are off" when filterStatus is emptied', async () => {
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    // Disable both active filters using the filter popover (first Status label is the popover's)
    fireEvent.click(screen.getByText(/Filters/))
    const statusSection = screen.getAllByText('Status')[0].closest('div')
    fireEvent.click(within(statusSection).getByText('To Do'))
    fireEvent.click(within(statusSection).getByText('In Progress'))
    expect(screen.getByText(/All status filters are off/)).toBeInTheDocument()
  })

  it('shows error banner when the API call fails', async () => {
    api.fetchTasks.mockRejectedValue(new Error('Network error'))
    render(<TaskList />)
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument())
  })

  it('dismissing the error banner removes it', async () => {
    api.fetchTasks.mockRejectedValue(new Error('Network error'))
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
    // Deactivate todo and in_progress, activate Done only — baseTask is 'todo' so no match
    fireEvent.click(screen.getByText(/Filters/))
    const statusSection = screen.getAllByText('Status')[0].closest('div')
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
    api.createTask = vi.fn().mockResolvedValue(newTask)
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
    api.updateTask.mockResolvedValue({ ...baseTask, title: 'Updated chore' })
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
    api.deleteTask = vi.fn().mockResolvedValue(undefined)
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
    // Confirm the inline delete prompt
    fireEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(api.deleteTask).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByText('Weekly chore')).not.toBeInTheDocument())
  })
})

// ── Patch task ────────────────────────────────────────────────────────────────

describe('TaskList — patch task', () => {
  it('patching a task updates it in place (non-done status)', async () => {
    api.updateTask.mockResolvedValue({ ...baseTask, status: 'in_progress' })
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
    api.fetchTasks.mockResolvedValue([taskWithSub])
  })

  it('toggling a subtask checkbox calls updateSubtask', async () => {
    api.updateSubtask = vi.fn().mockResolvedValue({ id: 20, title: 'Sub A', status: 'done', order: 0 })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    // Expand the card
    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByText('Sub A'))

    const checkbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(checkbox)

    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledWith(1, 20, { status: 'done' }))
  })

  it('adding a subtask via the inline input calls createSubtask', async () => {
    api.createSubtask = vi.fn().mockResolvedValue({ id: 21, title: 'Sub B', status: 'todo', order: 1 })
    render(<TaskList />)
    await waitFor(() => screen.getByText('Weekly chore'))

    fireEvent.click(screen.getByText('▸ subtasks'))
    await waitFor(() => screen.getByPlaceholderText('Add subtask…'))

    fireEvent.change(screen.getByPlaceholderText('Add subtask…'), { target: { value: 'Sub B' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Add subtask…'), { key: 'Enter' })

    await waitFor(() => expect(api.createSubtask).toHaveBeenCalledWith(1, { title: 'Sub B' }))
  })
})
