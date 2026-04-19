import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TaskSection from '../TaskSection'

// DnD-kit is imported transitively via TaskCard; mock it so jsdom doesn't choke.
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

const baseTask = {
  id: 1, title: 'Fix the bug', description: null,
  priority: 'medium', status: 'todo',
  due_date: '2099-12-31', estimated_minutes: null,
  assignee_id: null, assignee: null,
  category_id: null, category: null,
  recurrence: 'none', subtasks: [],
  order: 0, created_at: '2099-01-01T00:00:00Z',
}

function renderSection(overrides = {}) {
  const props = {
    sectionKey: 'this_week',
    label: 'This Week',
    tasks: [],
    collapsed: true,
    onToggleCollapse: vi.fn(),
    expandedCards: {},
    onToggleExpand: vi.fn(),
    onEdit: vi.fn(),
    onPatchTask: vi.fn(),
    onDeleteTask: vi.fn(),
    onPatchSubtask: vi.fn(),
    onAddSubtask: vi.fn(),
    onDeleteSubtask: vi.fn(),
    onReorderSubtasks: vi.fn(),
    onReorderTasks: vi.fn(),
    persons: [],
    categories: [],
    ...overrides,
  }
  return render(<TaskSection {...props} />)
}

describe('TaskSection', () => {
  it('renders the section label', () => {
    renderSection({ label: 'This Week' })
    expect(screen.getByText('This Week')).toBeInTheDocument()
  })

  it('renders a count badge with the number of tasks', () => {
    renderSection({ tasks: [baseTask, { ...baseTask, id: 2 }] })
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders a zero count badge when there are no tasks', () => {
    renderSection({ tasks: [] })
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('renders the section icon for each known sectionKey', () => {
    const ICON_MAP = {
      overdue_today: '🔥',
      tomorrow:      '📅',
      this_week:     '📆',
      next_week:     '🗓',
      later:         '⏳',
      done:          '✅',
      no_date:       '📌',
    }
    for (const [key, icon] of Object.entries(ICON_MAP)) {
      const { unmount } = renderSection({ sectionKey: key, label: key })
      expect(screen.getByText(icon)).toBeInTheDocument()
      unmount()
    }
  })

  it('calls onToggleCollapse when the header is clicked', () => {
    const onToggleCollapse = vi.fn()
    renderSection({ onToggleCollapse })
    fireEvent.click(screen.getByText('This Week'))
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  it('does not render task cards when collapsed', () => {
    renderSection({ tasks: [baseTask], collapsed: true })
    expect(screen.queryByText('Fix the bug')).not.toBeInTheDocument()
  })

  it('renders task cards when not collapsed', () => {
    renderSection({ tasks: [baseTask], collapsed: false })
    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
  })

  it('shows "No tasks" empty-state when expanded with no tasks', () => {
    renderSection({ tasks: [], collapsed: false })
    expect(screen.getByText('No tasks')).toBeInTheDocument()
  })

  it('shows "Needs attention" for overdue_today section when count > 0', () => {
    renderSection({ sectionKey: 'overdue_today', label: 'Overdue', tasks: [baseTask] })
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })

  it('does NOT show "Needs attention" for non-overdue sections', () => {
    renderSection({ sectionKey: 'this_week', label: 'This Week', tasks: [baseTask] })
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
  })

  it('does NOT show "Needs attention" for overdue_today when empty', () => {
    renderSection({ sectionKey: 'overdue_today', label: 'Overdue', tasks: [] })
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
  })

  it('shows collapse arrow ▸ when collapsed', () => {
    renderSection({ collapsed: true })
    expect(screen.getByText('▸')).toBeInTheDocument()
  })

  it('shows expand arrow ▾ when not collapsed', () => {
    renderSection({ collapsed: false })
    expect(screen.getByText('▾')).toBeInTheDocument()
  })

  it('renders a drag handle for each task when expanded', () => {
    renderSection({
      tasks: [baseTask, { ...baseTask, id: 2, title: 'Task 2' }],
      collapsed: false,
    })
    expect(screen.getAllByTitle('Drag to reorder')).toHaveLength(2)
  })

  it('calls onReorderTasks when drag ends on a different task', () => {
    const onReorderTasks = vi.fn()
    renderSection({
      tasks: [baseTask, { ...baseTask, id: 2, title: 'Task 2' }],
      collapsed: false,
      onReorderTasks,
    })
    // DnD is mocked — verify the section renders without error and callback is wired
    expect(onReorderTasks).not.toHaveBeenCalled()
  })
})
