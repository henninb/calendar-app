import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('@/lib/api', () => ({
  gcalAuthStatus: vi.fn(),
  syncToGtasks:   vi.fn(),
}))

import * as api from '@/lib/api'
import TaskToolbar, { type SortField, type SortDir } from '../TaskToolbar'
import { STATUS_OPTIONS } from '../helpers'

function renderToolbar(overrides: Record<string, unknown> = {}) {
  const props = {
    searchQuery: '',
    onSearch: vi.fn(),
    filterStatus: [...STATUS_OPTIONS],
    onToggleStatus: vi.fn(),
    filterAssignee: '',
    onFilterAssignee: vi.fn(),
    filterCategory: '',
    onFilterCategory: vi.fn(),
    persons: [],
    categories: [],
    loading: false,
    onRefresh: vi.fn(),
    sortField: 'due_date' as SortField,
    sortDir: 'asc' as SortDir,
    onSort: vi.fn(),
    onOpenPlanner: vi.fn(),
    ...overrides,
  }
  return render(<TaskToolbar {...props} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: true })
  vi.mocked(api.syncToGtasks).mockResolvedValue({ type: 'done', synced: 5, failed: 0, errors: [] })
})

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
    const btn = screen.getByText(/Filters/).closest('button')!
    expect(within(btn).queryByText('1')).not.toBeInTheDocument()
  })

  it('shows active filter count badge when a status filter is removed', () => {
    renderToolbar({ filterStatus: ['todo', 'in_progress', 'done'] })
    const btn = screen.getByText(/Filters/).closest('button')!
    expect(within(btn).getByText('1')).toBeInTheDocument()
  })

  it('shows active filter count 2 when both an assignee and a category are filtered', () => {
    renderToolbar({ filterAssignee: 'unassigned', filterCategory: '3' })
    const btn = screen.getByText(/Filters/).closest('button')!
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
    const btn = screen.getByRole('button', { name: 'Reload tasks from server' })
    expect(btn).toBeDisabled()
  })

  // ── Assignee / Category dropdowns ────────────────────────────────────────

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

  it('clicking "Clear all" resets assignee and category filters', () => {
    const onFilterAssignee = vi.fn()
    const onFilterCategory = vi.fn()
    renderToolbar({ filterStatus: ['todo'], onFilterAssignee, onFilterCategory })
    fireEvent.click(screen.getByText(/Filters/))
    fireEvent.click(screen.getByText('Clear all'))
    expect(onFilterAssignee).toHaveBeenCalledWith('')
    expect(onFilterCategory).toHaveBeenCalledWith('')
  })

  it('changing the assignee dropdown calls onFilterAssignee', () => {
    const onFilterAssignee = vi.fn()
    renderToolbar({ persons: [{ id: 1, name: 'Alice' }], onFilterAssignee })
    fireEvent.click(screen.getByText(/Filters/))
    const assigneeSection = screen.getByText('Assignee').closest('div')!
    fireEvent.change(assigneeSection.querySelector('select')!, { target: { value: '1' } })
    expect(onFilterAssignee).toHaveBeenCalledWith('1')
  })

  it('changing the category dropdown calls onFilterCategory', () => {
    const onFilterCategory = vi.fn()
    renderToolbar({ categories: [{ id: 3, name: 'Work', icon: '💼' }], onFilterCategory })
    fireEvent.click(screen.getByText(/Filters/))
    const categorySection = screen.getByText('Category').closest('div')!
    fireEvent.change(categorySection.querySelector('select')!, { target: { value: '3' } })
    expect(onFilterCategory).toHaveBeenCalledWith('3')
  })

  // ── Google Sync ───────────────────────────────────────────────────────────

  it('renders the Google Sync button', () => {
    renderToolbar()
    expect(screen.getByText(/Google Sync/)).toBeInTheDocument()
  })

  it('calls gcalAuthStatus on mount', async () => {
    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalledTimes(1))
  })

  it('calls syncToGtasks when authenticated and button is clicked', async () => {
    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() => expect(api.syncToGtasks).toHaveBeenCalledTimes(1))
  })

  it('shows "Syncing…" while in progress', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(api.syncToGtasks).mockReturnValue(new Promise(r => { resolve = r }))
    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() => expect(screen.getByText('Syncing…')).toBeInTheDocument())
    resolve({ type: 'done', synced: 0, failed: 0, errors: [] })
  })

  it('disables Google Sync button while syncing', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(api.syncToGtasks).mockReturnValue(new Promise(r => { resolve = r }))
    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    const btn = screen.getByRole('button', { name: /Google Sync/ })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    resolve({ type: 'done', synced: 0, failed: 0, errors: [] })
  })

  it('logs success after sync completes', async () => {
    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText(/Synced 5 tasks to Google Tasks/)).toBeInTheDocument()
    )
  })

  it('shows clear-log button after sync', async () => {
    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() => expect(screen.getByTitle('Clear log')).toBeInTheDocument())
  })

  it('clears log panel when clear button is clicked', async () => {
    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() => expect(screen.getByText(/Synced 5 tasks/)).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Clear log'))
    expect(screen.queryByText(/Synced 5 tasks/)).not.toBeInTheDocument()
  })

  it('logs error when syncToGtasks throws', async () => {
    vi.mocked(api.syncToGtasks).mockRejectedValue(new Error('Gtasks sync failed'))
    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText(/Google Tasks sync failed: Gtasks sync failed/)).toBeInTheDocument()
    )
  })

  it('redirects to /api/sync/auth when not authenticated', async () => {
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    const locationMock = { href: '' }
    vi.stubGlobal('location', locationMock)

    renderToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    expect(locationMock.href).toBe('/api/sync/auth')
    expect(api.syncToGtasks).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
