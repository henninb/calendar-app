import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import TaskToolbar from '../TaskToolbar'
import { STATUS_OPTIONS } from '../helpers'

function renderToolbar(overrides = {}) {
  const props = {
    searchQuery: '',
    onSearch: vi.fn(),
    filterStatus: [...STATUS_OPTIONS],        // all active by default
    onToggleStatus: vi.fn(),
    filterAssignee: '',
    onFilterAssignee: vi.fn(),
    filterCategory: '',
    onFilterCategory: vi.fn(),
    persons: [],
    categories: [],
    loading: false,
    onRefresh: vi.fn(),
    onNewTask: vi.fn(),
    ...overrides,
  }
  return render(<TaskToolbar {...props} />)
}

describe('TaskToolbar', () => {
  // ── Search ───────────────────────────────────────────────────────────────

  it('renders a search input with the correct placeholder', () => {
    renderToolbar()
    expect(screen.getByPlaceholderText('Search tasks…')).toBeInTheDocument()
  })

  it('reflects the searchQuery prop in the input value', () => {
    renderToolbar({ searchQuery: 'hello' })
    expect(screen.getByPlaceholderText('Search tasks…')).toHaveValue('hello')
  })

  it('calls onSearch when the user types in the search box', () => {
    const onSearch = vi.fn()
    renderToolbar({ onSearch })
    fireEvent.change(screen.getByPlaceholderText('Search tasks…'), {
      target: { value: 'milk' },
    })
    expect(onSearch).toHaveBeenCalledWith('milk')
  })

  // ── Filters button ────────────────────────────────────────────────────────

  it('renders a Filters button', () => {
    renderToolbar()
    expect(screen.getByText(/Filters/)).toBeInTheDocument()
  })

  it('clicking Filters button opens the filter popover', () => {
    renderToolbar()
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/Filters/))
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('filter popover shows all status pills', () => {
    renderToolbar()
    fireEvent.click(screen.getByText(/Filters/))
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('clicking a status pill calls onToggleStatus with that value', () => {
    const onToggleStatus = vi.fn()
    renderToolbar({ onToggleStatus })
    fireEvent.click(screen.getByText(/Filters/))
    fireEvent.click(screen.getByText('Done'))
    expect(onToggleStatus).toHaveBeenCalledWith('done')
  })

  it('shows no active-filter badge when all filters are default', () => {
    renderToolbar()
    const btn = screen.getByText(/Filters/).closest('button')
    // badge would be a child span with a number — should not be present
    expect(within(btn).queryByText('1')).not.toBeInTheDocument()
  })

  it('shows active filter count badge when a status filter is removed', () => {
    // Remove one status from the filter → activeCount becomes 1
    renderToolbar({ filterStatus: ['todo', 'in_progress', 'done'] }) // missing 'cancelled'
    const btn = screen.getByText(/Filters/).closest('button')
    expect(within(btn).getByText('1')).toBeInTheDocument()
  })

  it('shows active filter count 2 when both an assignee and a category are filtered', () => {
    renderToolbar({ filterAssignee: 'unassigned', filterCategory: '3' })
    const btn = screen.getByText(/Filters/).closest('button')
    expect(within(btn).getByText('2')).toBeInTheDocument()
  })

  it('popover shows "Clear all" when there are active filters', () => {
    renderToolbar({ filterStatus: ['todo'] })
    fireEvent.click(screen.getByText(/Filters/))
    expect(screen.getByText('Clear all')).toBeInTheDocument()
  })

  it('clicking outside the popover closes it', () => {
    renderToolbar()
    fireEvent.click(screen.getByText(/Filters/))
    expect(screen.getByText('Status')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
  })

  // ── Refresh ───────────────────────────────────────────────────────────────

  it('calls onRefresh when the Refresh button is clicked', () => {
    const onRefresh = vi.fn()
    renderToolbar({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: 'Reload tasks from server' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('Refresh button is disabled while loading', () => {
    renderToolbar({ loading: true })
    const btn = screen.getByText('…').closest('button')
    expect(btn).toBeDisabled()
  })

  // ── Assignee / Category dropdowns (only when persons/categories provided) ─

  it('shows an Assignee dropdown in the popover when persons are provided', () => {
    renderToolbar({ persons: [{ id: 1, name: 'Alice' }] })
    fireEvent.click(screen.getByText(/Filters/))
    expect(screen.getByText('Assignee')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows a Category dropdown in the popover when categories are provided', () => {
    renderToolbar({ categories: [{ id: 3, name: 'medical', icon: '🏥' }] })
    fireEvent.click(screen.getByText(/Filters/))
    expect(screen.getByText('Category')).toBeInTheDocument()
    expect(screen.getByText('🏥 medical')).toBeInTheDocument()
  })
})
