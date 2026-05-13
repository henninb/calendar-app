import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import React from 'react'
import TaskCard from '../TaskCard'
import { STATUS_LABELS } from '../helpers'

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

function renderCard(taskOverrides: Record<string, unknown> = {}, propOverrides: Record<string, unknown> = {}) {
  const task = { ...BASE_TASK, ...taskOverrides }
  const cbs = {
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

  it('shows 0/0 counter when there are no subtasks', () => {
    renderCard({ subtasks: [] })
    expect(screen.getByText('0/0')).toBeInTheDocument()
  })

  it('shows the expand toggle when subtasks exist', () => {
    renderCard({ subtasks })
    expect(screen.getByText('▸ subtasks')).toBeInTheDocument()
  })

  it('shows "▸ subtasks" toggle even when there are no subtasks', () => {
    renderCard({ subtasks: [] })
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

  it('clicking "▾ hide" when already expanded with 0 subtasks calls onToggleExpand to collapse', () => {
    const { cbs } = renderCard({ subtasks: [] }, { expanded: true })
    fireEvent.click(screen.getByText('▾ hide'))
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

describe('TaskCard — Start button (right-side icon)', () => {
  it('Start button is rendered next to the done circle for todo tasks', () => {
    renderCard({ status: 'todo' })
    const startBtn = screen.getByTitle('Start task')
    const doneBtn  = screen.getByTitle('Mark as done')
    expect(startBtn).toBeInTheDocument()
    expect(doneBtn).toBeInTheDocument()
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

  it('Start button is not rendered for ontime tasks', () => {
    renderCard({ status: 'ontime' })
    expect(screen.queryByTitle('Start task')).not.toBeInTheDocument()
  })

  it('clicking the Start button calls onPatchTask with in_progress', () => {
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
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete'))
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

})

// ── Status popover ────────────────────────────────────────────────────────────

describe('TaskCard — status popover', () => {
  it('status pill is visible and shows the current status label', () => {
    renderCard({ status: 'in_progress' })
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('clicking the status pill opens a popover with all 5 options', () => {
    renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('Change status'))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('To Do')).toBeInTheDocument()
    expect(within(menu).getByText('In Progress')).toBeInTheDocument()
    expect(within(menu).getByText('Done')).toBeInTheDocument()
    expect(within(menu).getByText('Cancelled')).toBeInTheDocument()
    expect(within(menu).getByText('On Time')).toBeInTheDocument()
  })

  it('selecting "Cancelled" calls onPatchTask with cancelled status', () => {
    const { cbs } = renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('Change status'))
    fireEvent.click(within(screen.getByRole('menu')).getByText('Cancelled'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'cancelled' })
  })

  it('selecting "To Do" from a done task calls onPatchTask with todo (reopen)', () => {
    const { cbs } = renderCard({ status: 'done' })
    fireEvent.click(screen.getByTitle('Change status'))
    fireEvent.click(within(screen.getByRole('menu')).getByText('To Do'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'todo' })
  })

  it('selecting "Done" with no incomplete subtasks calls onPatchTask with done', () => {
    const { cbs } = renderCard({ status: 'todo', subtasks: [] })
    fireEvent.click(screen.getByTitle('Change status'))
    fireEvent.click(within(screen.getByRole('menu')).getByText('Done'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'done' })
  })

  it('selecting "On Time" calls onPatchTask with ontime status', () => {
    const { cbs } = renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('Change status'))
    fireEvent.click(within(screen.getByRole('menu')).getByText('On Time'))
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'ontime' })
  })

  it('selecting "Done" with incomplete subtasks opens SubtaskConfirmModal', () => {
    renderCard({
      status: 'todo',
      subtasks: [{ id: 10, title: 'Step A', status: 'todo', order: 0, due_date: null }],
    })
    fireEvent.click(screen.getByTitle('Change status'))
    fireEvent.click(within(screen.getByRole('menu')).getByText('Done'))
    expect(screen.getByText('Incomplete subtasks')).toBeInTheDocument()
  })

  it('clicking outside the status popover closes it', () => {
    renderCard({ status: 'todo' })
    fireEvent.click(screen.getByTitle('Change status'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
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

describe('TaskCard — metadata fields always visible', () => {
  const emptyTask = {
    due_date: null,
    estimated_minutes: null,
    assignee_id: null,
    assignee: null,
  }

  it('shows a clickable due date button for active tasks with no due date', () => {
    renderCard(emptyTask)
    expect(screen.getByTitle('Click to set due date')).toBeInTheDocument()
  })

  it('shows a clickable assignee button for active tasks with no assignee', () => {
    renderCard(emptyTask)
    expect(screen.getByTitle('Click to edit assignee')).toBeInTheDocument()
  })

  it('shows a clickable duration button for active tasks with no estimated minutes', () => {
    renderCard(emptyTask)
    expect(screen.getByTitle('Click to edit duration')).toBeInTheDocument()
  })

  it('clicking the due date field opens the date input for active tasks', () => {
    renderCard(emptyTask)
    fireEvent.click(screen.getByTitle('Click to set due date'))
    expect(document.querySelector('input[type="date"]')).toBeInTheDocument()
  })

  it('does NOT show a clickable due date button for done tasks (field is read-only)', () => {
    renderCard({ ...emptyTask, status: 'done' })
    expect(screen.queryByTitle('Click to set due date')).not.toBeInTheDocument()
  })

  it('shows a clickable due date button when due date is set', () => {
    renderCard({ due_date: '2099-01-15' })
    expect(screen.getByTitle('Click to set due date')).toBeInTheDocument()
  })
})

// ── Complete all & mark done ──────────────────────────────────────────────────

describe('TaskCard — complete all subtasks and mark done', () => {
  it('"Complete all & mark done" patches each incomplete subtask then marks task done', async () => {
    const { cbs } = renderCard({
      subtasks: [
        { id: 10, title: 'Step A', status: 'todo', order: 0, due_date: null },
        { id: 11, title: 'Step B', status: 'todo', order: 1, due_date: null },
      ],
    })
    fireEvent.click(screen.getByTitle('Mark as done'))
    fireEvent.click(screen.getByText('Complete all & mark done'))
    await waitFor(() => {
      expect(cbs.onPatchSubtask).toHaveBeenCalledWith(1, 10, { status: 'done' })
      expect(cbs.onPatchSubtask).toHaveBeenCalledWith(1, 11, { status: 'done' })
      expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { status: 'done' })
    })
  })
})


// ── Inline due date editing ───────────────────────────────────────────────────

describe('TaskCard — inline due date editing', () => {
  it('changing the due date input calls onPatchTask', () => {
    const { cbs } = renderCard({ due_date: '2099-01-15' })
    fireEvent.click(screen.getByTitle('Click to set due date'))
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2099-06-01' } })
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { due_date: '2099-06-01' })
  })

  it('pressing Escape on the due date input closes the editor', () => {
    renderCard({ due_date: '2099-01-15' })
    fireEvent.click(screen.getByTitle('Click to set due date'))
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument()
  })

  it('pressing Enter on the due date input calls onPatchTask', () => {
    const { cbs } = renderCard({ due_date: '2099-01-15' })
    fireEvent.click(screen.getByTitle('Click to set due date'))
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(cbs.onPatchTask).toHaveBeenCalled()
  })

  it('blurring the due date input calls onPatchTask', () => {
    const { cbs } = renderCard({ due_date: '2099-01-15' })
    fireEvent.click(screen.getByTitle('Click to set due date'))
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.blur(input)
    expect(cbs.onPatchTask).toHaveBeenCalled()
  })
})

// ── Inline assignee editing ───────────────────────────────────────────────────

describe('TaskCard — inline assignee editing', () => {
  const persons = [{ id: 5, name: 'Alice' }]

  it('clicking the assignee field opens a select with person options', () => {
    renderCard({}, { persons })
    fireEvent.click(screen.getByTitle('Click to edit assignee'))
    const select = screen.getByRole('combobox')
    expect(within(select).getByText('Alice')).toBeInTheDocument()
  })

  it('selecting an assignee calls onPatchTask with the assignee_id', () => {
    const { cbs } = renderCard({}, { persons })
    fireEvent.click(screen.getByTitle('Click to edit assignee'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } })
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { assignee_id: '5' })
  })

  it('pressing Escape on the assignee select closes it', () => {
    renderCard({}, { persons })
    fireEvent.click(screen.getByTitle('Click to edit assignee'))
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

// ── Inline estimated-minutes editing ─────────────────────────────────────────

describe('TaskCard — inline estimated minutes editing', () => {
  it('blurring the minutes input calls onPatchTask', () => {
    const { cbs } = renderCard({})
    fireEvent.click(screen.getByTitle('Click to edit duration'))
    const input = screen.getByPlaceholderText('e.g. 1h30m')
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.blur(input)
    expect(cbs.onPatchTask).toHaveBeenCalledWith(1, { estimated_minutes: 45 })
  })

  it('pressing Enter in the minutes input calls onPatchTask', () => {
    const { cbs } = renderCard({})
    fireEvent.click(screen.getByTitle('Click to edit duration'))
    const input = screen.getByPlaceholderText('e.g. 1h30m')
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.keyDown(input, { key: 'Enter', target: { value: '30' } })
    expect(cbs.onPatchTask).toHaveBeenCalled()
  })

  it('pressing Escape on the minutes input closes it', () => {
    renderCard({})
    fireEvent.click(screen.getByTitle('Click to edit duration'))
    fireEvent.keyDown(screen.getByPlaceholderText('e.g. 1h30m'), { key: 'Escape' })
    expect(screen.queryByPlaceholderText('e.g. 1h30m')).not.toBeInTheDocument()
  })
})

// ── Subtask row editing in expanded card ──────────────────────────────────────

describe('TaskCard — subtask row inline editing', () => {
  const subtasks = [
    { id: 10, title: 'Milk', status: 'done', order: 0, due_date: null },
    { id: 11, title: 'Eggs', status: 'todo', order: 1, due_date: null },
  ]

  it('clicking a non-done subtask title shows an edit input', () => {
    renderCard({ subtasks }, { expanded: true })
    fireEvent.click(screen.getByText('Eggs'))
    expect(screen.getByDisplayValue('Eggs')).toBeInTheDocument()
  })

  it('changing the subtask edit input updates the draft value', () => {
    renderCard({ subtasks }, { expanded: true })
    fireEvent.click(screen.getByText('Eggs'))
    fireEvent.change(screen.getByDisplayValue('Eggs'), { target: { value: 'Scrambled Eggs' } })
    expect(screen.getByDisplayValue('Scrambled Eggs')).toBeInTheDocument()
  })

  it('pressing Enter in subtask edit input calls onPatchSubtask with new title', () => {
    const { cbs } = renderCard({ subtasks }, { expanded: true })
    fireEvent.click(screen.getByText('Eggs'))
    const input = screen.getByDisplayValue('Eggs')
    fireEvent.change(input, { target: { value: 'Boiled Eggs' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(cbs.onPatchSubtask).toHaveBeenCalledWith(1, 11, { title: 'Boiled Eggs' })
  })

  it('pressing Escape in subtask edit input cancels editing without saving', () => {
    const { cbs } = renderCard({ subtasks }, { expanded: true })
    fireEvent.click(screen.getByText('Eggs'))
    fireEvent.keyDown(screen.getByDisplayValue('Eggs'), { key: 'Escape' })
    expect(cbs.onPatchSubtask).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('Eggs')).not.toBeInTheDocument()
  })

  it('blurring the subtask edit input saves via onPatchSubtask', () => {
    const { cbs } = renderCard({ subtasks }, { expanded: true })
    fireEvent.click(screen.getByText('Eggs'))
    const input = screen.getByDisplayValue('Eggs')
    fireEvent.change(input, { target: { value: 'Fried Eggs' } })
    fireEvent.blur(input)
    expect(cbs.onPatchSubtask).toHaveBeenCalledWith(1, 11, { title: 'Fried Eggs' })
  })

  it('clicking "Cancel edit" button closes the editing input', () => {
    const { cbs } = renderCard({ subtasks }, { expanded: true })
    fireEvent.click(screen.getByText('Eggs'))
    expect(screen.getByDisplayValue('Eggs')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Cancel edit'))
    expect(cbs.onPatchSubtask).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('Eggs')).not.toBeInTheDocument()
  })

  it('toggling a subtask checkbox calls onPatchSubtask with the new status', () => {
    const { cbs } = renderCard({ subtasks }, { expanded: true })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    expect(cbs.onPatchSubtask).toHaveBeenCalledWith(1, 11, { status: 'done' })
  })

  it('unchecking a done subtask calls onPatchSubtask with todo', () => {
    const { cbs } = renderCard({ subtasks }, { expanded: true })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    expect(cbs.onPatchSubtask).toHaveBeenCalledWith(1, 10, { status: 'todo' })
  })

  it('clicking the delete button on a subtask calls onDeleteSubtask', () => {
    const { cbs } = renderCard({ subtasks }, { expanded: true })
    const deleteBtn = screen.getAllByTitle('Delete subtask')[0]
    fireEvent.click(deleteBtn)
    expect(cbs.onDeleteSubtask).toHaveBeenCalledWith(1, 10)
  })
})

// ── Subtask row — zero subtask state ─────────────────────────────────────────

describe('TaskCard — subtask row with 0 subtasks', () => {
  it('clicking "▸ subtasks" on a collapsed card calls onToggleExpand', () => {
    const { cbs } = renderCard({ subtasks: [] }, { expanded: false })
    fireEvent.click(screen.getByText('▸ subtasks'))
    expect(cbs.onToggleExpand).toHaveBeenCalledWith(1)
  })
})

