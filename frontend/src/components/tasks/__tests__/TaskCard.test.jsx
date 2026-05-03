import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import TaskCard from '../TaskCard'
import { STATUS_LABELS } from '../helpers'

// Mock DnD-kit so jsdom doesn't need a real pointer-events implementation.
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_TASK = {
  id: 1, title: 'Buy groceries', description: null,
  priority: 'medium', status: 'todo',
  due_date: '2099-12-31', estimated_minutes: null,
  assignee_id: null, assignee: null,
  category_id: null, category: null,
  recurrence: 'none', subtasks: [],
}

const BASE_PROPS = {
  expanded: false,
  persons: [],
  categories: [],
}

function renderCard(taskOverrides = {}, propOverrides = {}) {
  const task = { ...BASE_TASK, ...taskOverrides }
  const cbs  = {
    onToggleExpand:    vi.fn(),
    onEdit:            vi.fn(),
    onPatchTask:       vi.fn(),
    onDeleteTask:      vi.fn(),
    onPatchSubtask:    vi.fn(),
    onAddSubtask:      vi.fn(),
    onDeleteSubtask:   vi.fn(),
    onReorderSubtasks: vi.fn(),
    ...propOverrides,
  }
  return { ...render(<TaskCard task={task} {...BASE_PROPS} {...cbs} />), task, cbs }
}

// ── Basic rendering ───────────────────────────────────────────────────────────

describe('TaskCard — basic rendering', () => {
  it('renders the task title', () => {
    renderCard()
    expect(screen.getByText('Buy groceries')).toBeInTheDocument()
  })

  it('renders the correct status pill label for each status', () => {
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      const { unmount } = renderCard({ status })
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('shows the circular done-button for active tasks', () => {
    renderCard({ status: 'todo' })
    expect(screen.getByTitle('Mark as done')).toBeInTheDocument()
  })

  it('shows a checkmark icon instead of done-button for done tasks', () => {
    renderCard({ status: 'done' })
    // Action button replaced by filled circle indicator; ✓ also appears in status pill
    expect(screen.queryByTitle('Mark as done')).not.toBeInTheDocument()
    expect(screen.getAllByText('✓').length).toBeGreaterThan(0)
  })

  it('renders a category badge when task has a category', () => {
    renderCard({ category: { name: 'medical', icon: '🏥', color: '#ec4899' } })
    expect(screen.getByText('🏥 medical')).toBeInTheDocument()
  })

  it('renders a recurrence badge when recurrence is set', () => {
    renderCard({ recurrence: 'weekly' })
    expect(screen.getByText('↻ weekly')).toBeInTheDocument()
  })
})

// ── Mark-done flow ────────────────────────────────────────────────────────────

describe('TaskCard — mark-done flow', () => {
  it('calls onPatchTask with status done when no incomplete subtasks', () => {
    const { cbs } = renderCard({ subtasks: [] })
    fireEvent.click(screen.getByTitle('Mark as done'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'done' })
  })

  it('opens the SubtaskConfirmModal when there are incomplete subtasks', () => {
    renderCard({
      subtasks: [
        { id: 10, title: 'Step A', status: 'todo', order: 0, due_date: null },
      ],
    })
    fireEvent.click(screen.getByTitle('Mark as done'))
    expect(screen.getByText('Incomplete subtasks')).toBeInTheDocument()
  })

  it('modal lists incomplete subtask titles', () => {
    renderCard({
      subtasks: [
        { id: 10, title: 'Step A', status: 'todo',      order: 0, due_date: null },
        { id: 11, title: 'Step B', status: 'done',      order: 1, due_date: null },
        { id: 12, title: 'Step C', status: 'cancelled', order: 2, due_date: null },
      ],
    })
    fireEvent.click(screen.getByTitle('Mark as done'))
    expect(screen.getByText('Step A')).toBeInTheDocument()
    expect(screen.queryByText('Step B')).not.toBeInTheDocument()
    expect(screen.queryByText('Step C')).not.toBeInTheDocument()
  })

  it('"Mark done anyway" button patches task and closes modal', () => {
    const { cbs } = renderCard({
      subtasks: [{ id: 10, title: 'Step A', status: 'todo', order: 0, due_date: null }],
    })
    fireEvent.click(screen.getByTitle('Mark as done'))
    fireEvent.click(screen.getByText('Mark done anyway'))

    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'done' })
    expect(screen.queryByText('Incomplete subtasks')).not.toBeInTheDocument()
  })

  it('"Cancel" button closes modal without calling onPatchTask', () => {
    const { cbs } = renderCard({
      subtasks: [{ id: 10, title: 'Step A', status: 'todo', order: 0, due_date: null }],
    })
    fireEvent.click(screen.getByTitle('Mark as done'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(cbs.onPatchTask).not.toHaveBeenCalled()
    expect(screen.queryByText('Incomplete subtasks')).not.toBeInTheDocument()
  })

  it('Escape key closes the modal', () => {
    renderCard({
      subtasks: [{ id: 10, title: 'Step A', status: 'todo', order: 0, due_date: null }],
    })
    fireEvent.click(screen.getByTitle('Mark as done'))
    expect(screen.getByText('Incomplete subtasks')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Incomplete subtasks')).not.toBeInTheDocument()
  })
})

// ── Start button ──────────────────────────────────────────────────────────────

describe('TaskCard — Start button', () => {
  it('shows Start button for todo tasks', () => {
    renderCard({ status: 'todo' })
    expect(screen.getByTitle('Start task')).toBeInTheDocument()
  })

  it('hides Start button for in_progress tasks', () => {
    renderCard({ status: 'in_progress' })
    expect(screen.queryByTitle('Start task')).not.toBeInTheDocument()
  })

  it('hides Start button for done tasks', () => {
    renderCard({ status: 'done' })
    expect(screen.queryByTitle('Start task')).not.toBeInTheDocument()
  })

  it('clicking Start button calls onPatchTask with in_progress', () => {
    const { cbs } = renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('Start task'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'in_progress' })
  })
})

// ── Inline title editing ──────────────────────────────────────────────────────

describe('TaskCard — inline title editing', () => {
  it('double-clicking the title enters edit mode (shows input)', () => {
    renderCard({ status: 'todo' })
    const titleSpan = screen.getByText('Buy groceries')
    fireEvent.dblClick(titleSpan)
    expect(screen.getByDisplayValue('Buy groceries')).toBeInTheDocument()
  })

  it('pressing Escape cancels editing without calling onPatchTask', () => {
    const { cbs } = renderCard({ status: 'todo' })
    fireEvent.dblClick(screen.getByText('Buy groceries'))
    fireEvent.keyDown(screen.getByDisplayValue('Buy groceries'), { key: 'Escape' })

    expect(cbs.onPatchTask).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('Buy groceries')).not.toBeInTheDocument()
  })

  it('pressing Enter with a changed title calls onPatchTask', () => {
    const { cbs } = renderCard({ status: 'todo' })
    fireEvent.dblClick(screen.getByText('Buy groceries'))
    const input = screen.getByDisplayValue('Buy groceries')
    fireEvent.change(input, { target: { value: 'Buy organic groceries' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { title: 'Buy organic groceries' })
  })

  it('pressing Enter with an unchanged title does NOT call onPatchTask', () => {
    const { cbs } = renderCard({ status: 'todo' })
    fireEvent.dblClick(screen.getByText('Buy groceries'))
    fireEvent.keyDown(screen.getByDisplayValue('Buy groceries'), { key: 'Enter' })

    expect(cbs.onPatchTask).not.toHaveBeenCalled()
  })

  it('does NOT enter edit mode on double-click for done tasks', () => {
    renderCard({ status: 'done' })
    const titleSpan = screen.getByText('Buy groceries')
    fireEvent.dblClick(titleSpan)
    expect(screen.queryByDisplayValue('Buy groceries')).not.toBeInTheDocument()
  })

  it('does NOT enter edit mode on double-click for cancelled tasks', () => {
    renderCard({ status: 'cancelled' })
    const titleSpan = screen.getByText('Buy groceries')
    fireEvent.dblClick(titleSpan)
    expect(screen.queryByDisplayValue('Buy groceries')).not.toBeInTheDocument()
  })
})

// ── Subtask progress & expansion ──────────────────────────────────────────────

describe('TaskCard — subtasks', () => {
  const subtasks = [
    { id: 10, title: 'Milk', status: 'done', order: 0, due_date: null },
    { id: 11, title: 'Eggs', status: 'todo', order: 1, due_date: null },
  ]

  it('shows a subtask progress counter when subtasks exist', () => {
    renderCard({ subtasks })
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('shows the expand toggle when subtasks exist', () => {
    renderCard({ subtasks })
    expect(screen.getByText('▸ subtasks')).toBeInTheDocument()
  })

  it('clicking expand toggle calls onToggleExpand with task id', () => {
    const { cbs } = renderCard({ subtasks })
    fireEvent.click(screen.getByText('▸ subtasks'))
    expect(cbs.onToggleExpand).toHaveBeenCalledWith(1)
  })

  it('renders subtask titles when expanded', () => {
    renderCard({ subtasks }, { expanded: true })
    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(screen.getByText('Eggs')).toBeInTheDocument()
  })

  it('renders the add-subtask input when expanded', () => {
    renderCard({ subtasks }, { expanded: true })
    expect(screen.getByPlaceholderText('Add subtask…')).toBeInTheDocument()
  })

  it('add-subtask button is disabled when the input is empty', () => {
    renderCard({ subtasks }, { expanded: true })
    const addBtn = screen.getByText('Add').closest('button')
    expect(addBtn).toBeDisabled()
  })

  it('add-subtask button is enabled after typing in the input', () => {
    renderCard({ subtasks }, { expanded: true })
    fireEvent.change(screen.getByPlaceholderText('Add subtask…'), {
      target: { value: 'Bread' },
    })
    const addBtn = screen.getByText('Add').closest('button')
    expect(addBtn).not.toBeDisabled()
  })

  it('pressing Enter in the add-subtask input calls onAddSubtask', () => {
    const { cbs } = renderCard({ subtasks }, { expanded: true })
    fireEvent.change(screen.getByPlaceholderText('Add subtask…'), {
      target: { value: 'Bread' },
    })
    fireEvent.keyDown(screen.getByPlaceholderText('Add subtask…'), { key: 'Enter' })
    expect(cbs.onAddSubtask).toHaveBeenCalledWith(1, 'Bread')
  })

  it('shows task description when expanded and description is present', () => {
    renderCard({ subtasks, description: 'From the corner store' }, { expanded: true })
    expect(screen.getByText('From the corner store')).toBeInTheDocument()
  })

  it('clicking "+ Add subtask" when already expanded calls onToggleExpand to collapse', () => {
    const { cbs } = renderCard({ subtasks: [] }, { expanded: true })
    fireEvent.click(screen.getByText('Add subtask'))
    expect(cbs.onToggleExpand).toHaveBeenCalledWith(1)
  })

  it('Escape on empty add-subtask input calls onToggleExpand to collapse', () => {
    const { cbs } = renderCard({ subtasks: [] }, { expanded: true })
    const input = screen.getByPlaceholderText('Add subtask…')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(cbs.onToggleExpand).toHaveBeenCalledWith(1)
  })

  it('Escape collapses even when add-subtask input has a value', () => {
    const { cbs } = renderCard({ subtasks: [] }, { expanded: true })
    const input = screen.getByPlaceholderText('Add subtask…')
    fireEvent.change(input, { target: { value: 'Half-typed' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(cbs.onToggleExpand).toHaveBeenCalledWith(1)
  })
})

// ── Start button position ─────────────────────────────────────────────────────

describe('TaskCard — Start button (left-side icon)', () => {
  it('Start button is rendered next to the done circle for todo tasks', () => {
    renderCard({ status: 'todo' })
    const startBtn = screen.getByTitle('Start task')
    const doneBtn  = screen.getByTitle('Mark as done')
    // Both should be in the DOM and the start button should follow the done button
    expect(startBtn).toBeInTheDocument()
    expect(doneBtn).toBeInTheDocument()
    // They share a parent wrapper — done button comes first in the DOM
    expect(doneBtn.compareDocumentPosition(startBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Start button is not rendered for in_progress tasks', () => {
    renderCard({ status: 'in_progress' })
    expect(screen.queryByTitle('Start task')).not.toBeInTheDocument()
  })

  it('Start button is not rendered for done tasks', () => {
    renderCard({ status: 'done' })
    expect(screen.queryByTitle('Start task')).not.toBeInTheDocument()
  })

  it('Start button is not rendered for cancelled tasks', () => {
    renderCard({ status: 'cancelled' })
    expect(screen.queryByTitle('Start task')).not.toBeInTheDocument()
  })

  it('clicking the left-side Start button calls onPatchTask with in_progress', () => {
    const { cbs } = renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('Start task'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'in_progress' })
  })
})

// ── Overflow menu ─────────────────────────────────────────────────────────────

describe('TaskCard — overflow menu', () => {
  it('overflow menu is hidden by default', () => {
    renderCard()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })

  it('clicking "···" opens the overflow menu', () => {
    renderCard()
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.getByText('Edit')).toBeInTheDocument()
  })

  it('"Edit" menu item calls onEdit with the task', () => {
    const { cbs, task } = renderCard()
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Edit'))
    expect(cbs.onEdit).toHaveBeenCalledWith(task)
  })

  it('"Delete" menu item shows inline confirmation instead of calling onDeleteTask immediately', () => {
    const { cbs } = renderCard()
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Delete'))
    expect(cbs.onDeleteTask).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this task?')).toBeInTheDocument()
  })

  it('"Cancel" menu item appears for todo tasks', () => {
    renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('"Cancel" menu item appears for in_progress tasks', () => {
    renderCard({ status: 'in_progress' })
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('"Cancel" menu item calls onPatchTask with cancelled status', () => {
    const { cbs } = renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'cancelled' })
  })

  it('"Cancel" menu item is hidden for already-cancelled tasks', () => {
    renderCard({ status: 'cancelled' })
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('"Reopen" menu item appears for done tasks', () => {
    renderCard({ status: 'done' })
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.getByText('Reopen')).toBeInTheDocument()
  })

  it('"Reopen" menu item calls onPatchTask with todo status', () => {
    const { cbs } = renderCard({ status: 'done' })
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Reopen'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'todo' })
  })

  it('"Copy" menu item writes the task title to the clipboard', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    renderCard()
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Buy groceries')
  })

  it('confirming delete calls onDeleteTask with the task id', () => {
    const { cbs } = renderCard()
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Delete'))         // opens confirmation
    fireEvent.click(screen.getByText('Delete'))         // menu is gone; this hits the confirm button
    expect(cbs.onDeleteTask).toHaveBeenCalledWith(1)
  })

  it('cancelling the delete confirmation hides it without calling onDeleteTask', () => {
    const { cbs } = renderCard()
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(cbs.onDeleteTask).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete this task?')).not.toBeInTheDocument()
  })

  it('pressing Escape dismisses the delete confirmation', () => {
    const { cbs } = renderCard()
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText('Delete this task?')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cbs.onDeleteTask).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete this task?')).not.toBeInTheDocument()
  })

  it('clicking outside the overflow menu closes it', () => {
    renderCard()
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.getByText('Edit')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })

  it('"Complete" menu item appears for todo tasks', () => {
    renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })

  it('"Complete" menu item appears for in_progress tasks', () => {
    renderCard({ status: 'in_progress' })
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })

  it('"Complete" menu item is hidden for done tasks', () => {
    renderCard({ status: 'done' })
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.queryByText('Complete')).not.toBeInTheDocument()
  })

  it('"Complete" menu item is hidden for cancelled tasks', () => {
    renderCard({ status: 'cancelled' })
    fireEvent.click(screen.getByTitle('More actions'))
    expect(screen.queryByText('Complete')).not.toBeInTheDocument()
  })

  it('"Complete" menu item calls onPatchTask with done for a task with no incomplete subtasks', () => {
    const { cbs } = renderCard({ status: 'todo', subtasks: [] })
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Complete'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'done' })
  })

  it('"Complete" menu item opens SubtaskConfirmModal when incomplete subtasks exist', () => {
    renderCard({
      status: 'todo',
      subtasks: [{ id: 10, title: 'Step A', status: 'todo', order: 0, due_date: null }],
    })
    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByText('Complete'))
    expect(screen.getByText('Incomplete subtasks')).toBeInTheDocument()
  })
})

// ── Inline category editing ───────────────────────────────────────────────────

describe('TaskCard — inline category editing', () => {
  const CATS = [
    { id: 1, name: 'Work',     icon: '💼', color: '#3b82f6' },
    { id: 2, name: 'Personal', icon: '🏠', color: '#10b981' },
  ]
  const categoryTask = {
    category_id: 1,
    category: CATS[0],
  }

  it('renders the category badge', () => {
    renderCard(categoryTask, { categories: CATS })
    expect(screen.getByText('💼 Work')).toBeInTheDocument()
  })

  it('double-clicking the category badge opens a select for active tasks', () => {
    renderCard(categoryTask, { categories: CATS })
    fireEvent.dblClick(screen.getByText('💼 Work'))
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('does NOT open category editor on double-click for done tasks', () => {
    renderCard({ ...categoryTask, status: 'done' }, { categories: CATS })
    fireEvent.dblClick(screen.getByText('💼 Work'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('does NOT open category editor on double-click for cancelled tasks', () => {
    renderCard({ ...categoryTask, status: 'cancelled' }, { categories: CATS })
    fireEvent.dblClick(screen.getByText('💼 Work'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('selecting a new category calls onPatchTask with the parsed category_id', () => {
    const { cbs } = renderCard(categoryTask, { categories: CATS })
    fireEvent.dblClick(screen.getByText('💼 Work'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } })
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { category_id: 2 })
  })

  it('selecting the empty option calls onPatchTask with null', () => {
    const { cbs } = renderCard(categoryTask, { categories: CATS })
    fireEvent.dblClick(screen.getByText('💼 Work'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { category_id: null })
  })

  it('pressing Escape closes the editor without saving', () => {
    const { cbs } = renderCard(categoryTask, { categories: CATS })
    fireEvent.dblClick(screen.getByText('💼 Work'))
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(cbs.onPatchTask).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

// ── Subtask row full-width click target ───────────────────────────────────────

describe('TaskCard — subtask row full-width click target', () => {
  const subtasks = [
    { id: 10, title: 'Milk', status: 'done', order: 0, due_date: null },
    { id: 11, title: 'Eggs', status: 'todo', order: 1, due_date: null },
  ]

  it('clicking the progress bar area calls onToggleExpand', () => {
    const { cbs } = renderCard({ subtasks })
    // The progress bar lives inside the full-width button — click the counter label
    fireEvent.click(screen.getByText('1/2'))
    expect(cbs.onToggleExpand).toHaveBeenCalledWith(1)
  })

  it('clicking the chevron label also calls onToggleExpand', () => {
    const { cbs } = renderCard({ subtasks })
    fireEvent.click(screen.getByText('▸ subtasks'))
    expect(cbs.onToggleExpand).toHaveBeenCalledWith(1)
  })

  it('shows "▾ hide" label when expanded', () => {
    renderCard({ subtasks }, { expanded: true })
    expect(screen.getByText('▾ hide')).toBeInTheDocument()
  })
})

// ── Pencil button for title editing ──────────────────────────────────────────

describe('TaskCard — pencil title edit button', () => {
  it('renders the pencil button for active tasks', () => {
    renderCard({ status: 'todo' })
    expect(screen.getByTitle('Edit title')).toBeInTheDocument()
  })

  it('clicking the pencil button enters title edit mode', () => {
    renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('Edit title'))
    expect(screen.getByDisplayValue('Buy groceries')).toBeInTheDocument()
  })

  it('does NOT render pencil button for done tasks', () => {
    renderCard({ status: 'done' })
    expect(screen.queryByTitle('Edit title')).not.toBeInTheDocument()
  })

  it('does NOT render pencil button for cancelled tasks', () => {
    renderCard({ status: 'cancelled' })
    expect(screen.queryByTitle('Edit title')).not.toBeInTheDocument()
  })
})

// ── Always-visible metadata fields ───────────────────────────────────────────

describe('TaskCard — metadata fields always visible for active tasks', () => {
  const emptyTask = {
    due_date: null,
    estimated_minutes: null,
    assignee_id: null,
    assignee: null,
  }

  it('shows "Add date" ghost when task has no due date', () => {
    renderCard(emptyTask)
    expect(screen.getByText('Add date')).toBeInTheDocument()
  })

  it('shows "Unassigned" when task has no assignee', () => {
    renderCard(emptyTask)
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('shows "Add duration" ghost when task has no estimated minutes', () => {
    renderCard(emptyTask)
    expect(screen.getByText('Add duration')).toBeInTheDocument()
  })

  it('clicking "Add date" opens the date input for active tasks', () => {
    renderCard(emptyTask)
    fireEvent.click(screen.getByText('Add date'))
    expect(document.querySelector('input[type="date"]')).toBeInTheDocument()
  })

  it('does NOT show "Add date" for done tasks with no due date', () => {
    renderCard({ ...emptyTask, status: 'done' })
    expect(screen.queryByText('Add date')).not.toBeInTheDocument()
  })

  it('shows actual date text (not ghost) when due date is set', () => {
    renderCard({ due_date: '2099-01-15' })
    expect(screen.queryByText('Add date')).not.toBeInTheDocument()
  })
})
