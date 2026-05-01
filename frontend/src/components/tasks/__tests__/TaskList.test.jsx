import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

    // Open the overflow menu and click Cancel (task sections render before TaskPanel in DOM)
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getAllByText('Cancel')[0])

    // silentLoad should fire fetchTasks a second time to pick up the spawned successor
    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalledTimes(2))
  })
})
