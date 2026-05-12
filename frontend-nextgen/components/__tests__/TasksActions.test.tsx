// Google Sync behavior is now tested via TaskToolbar — see components/tasks/__tests__/TaskToolbar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('@/lib/api', () => ({
  gcalAuthStatus: vi.fn(),
  syncToGtasks:   vi.fn(),
}))

import * as api from '@/lib/api'
import TaskToolbar from '@/components/tasks/TaskToolbar'
import { STATUS_OPTIONS } from '@/components/tasks/helpers'

function renderWithToolbar() {
  return render(
    <TaskToolbar
      searchQuery=""
      onSearch={vi.fn()}
      filterStatus={[...STATUS_OPTIONS]}
      onToggleStatus={vi.fn()}
      filterAssignee=""
      onFilterAssignee={vi.fn()}
      filterCategory=""
      onFilterCategory={vi.fn()}
      persons={[]}
      categories={[]}
      loading={false}
      onRefresh={vi.fn()}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: true })
  vi.mocked(api.syncToGtasks).mockResolvedValue({ type: 'done', synced: 5, failed: 0, errors: [] })
})

describe('TasksActions — initial render', () => {
  it('renders the Google Sync button', () => {
    renderWithToolbar()
    expect(screen.getByText(/Google Sync/)).toBeInTheDocument()
  })

  it('calls gcalAuthStatus on mount', async () => {
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalledTimes(1))
  })

  it('shows button in authenticated style when connected', async () => {
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    const btn = screen.getByText(/Google Sync/)
    expect(btn).toBeInTheDocument()
  })

  it('falls back to gcalAuth=false when gcalAuthStatus throws', async () => {
    vi.mocked(api.gcalAuthStatus).mockRejectedValue(new Error('Network down'))
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    expect(screen.queryByText(/Google Sync/)).toBeInTheDocument()
  })
})

describe('TasksActions — sync button when not authenticated', () => {
  it('redirects to /api/sync/auth when not authenticated', async () => {
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    const locationMock = { href: '' }
    vi.stubGlobal('location', locationMock)

    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    expect(locationMock.href).toBe('/api/sync/auth')
    expect(api.syncToGtasks).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

describe('TasksActions — successful sync', () => {
  it('calls syncToGtasks when authenticated and button is clicked', async () => {
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() => expect(api.syncToGtasks).toHaveBeenCalledTimes(1))
  })

  it('shows "Syncing…" while in progress', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(api.syncToGtasks).mockReturnValue(new Promise(r => { resolve = r }))
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() => expect(screen.getByText('Syncing…')).toBeInTheDocument())
    resolve({ type: 'done', synced: 0, failed: 0, errors: [] })
  })

  it('disables button while syncing', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(api.syncToGtasks).mockReturnValue(new Promise(r => { resolve = r }))
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    const btn = screen.getByRole('button', { name: /Google Sync/ })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    resolve({ type: 'done', synced: 0, failed: 0, errors: [] })
  })

  it('logs success after sync completes', async () => {
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText(/Synced 5 tasks to Google Tasks/)).toBeInTheDocument()
    )
  })

  it('shows log panel after sync', async () => {
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByTitle('Clear log')).toBeInTheDocument()
    )
  })

  it('clears log panel when clear button is clicked', async () => {
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() => expect(screen.getByText(/Synced 5 tasks/)).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Clear log'))
    expect(screen.queryByText(/Synced 5 tasks/)).not.toBeInTheDocument()
  })
})

describe('TasksActions — sync failure', () => {
  it('logs error when syncToGtasks throws', async () => {
    vi.mocked(api.syncToGtasks).mockRejectedValue(new Error('Gtasks sync failed'))
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText(/Google Tasks sync failed: Gtasks sync failed/)).toBeInTheDocument()
    )
  })

  it('re-enables button after failure', async () => {
    vi.mocked(api.syncToGtasks).mockRejectedValue(new Error('Fail'))
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    const btn = screen.getByRole('button', { name: /Google Sync/ })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).not.toBeDisabled())
  })
})

describe('TasksActions — partial failure', () => {
  it('shows warn log when some tasks fail', async () => {
    vi.mocked(api.syncToGtasks).mockResolvedValue({ type: 'done', synced: 3, failed: 2, errors: ['err1', 'err2'] })
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText(/2 failed/)).toBeInTheDocument()
    )
  })

  it('logs quota exceeded warning when quota error present', async () => {
    vi.mocked(api.syncToGtasks).mockResolvedValue({
      type: 'done',
      synced: 0,
      failed: 1,
      errors: ['quotaExceeded: daily limit reached'],
    })
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument()
    )
  })

  it('logs individual errors when non-quota failures occur', async () => {
    vi.mocked(api.syncToGtasks).mockResolvedValue({
      type: 'done',
      synced: 1,
      failed: 1,
      errors: ['Task 42: not found'],
    })
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText('Task 42: not found')).toBeInTheDocument()
    )
  })

  it('logs reconnect warning for non-quota failures', async () => {
    vi.mocked(api.syncToGtasks).mockResolvedValue({
      type: 'done',
      synced: 2,
      failed: 1,
      errors: ['some error'],
    })
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText(/reconnect Google/i)).toBeInTheDocument()
    )
  })
})

describe('TasksActions — progress events', () => {
  it('handles start and progress SSE events during sync', async () => {
    vi.mocked(api.syncToGtasks).mockImplementation(async (onProgress) => {
      onProgress?.({ type: 'start', total: 4 })
      onProgress?.({ type: 'progress', msg: '2/4 synced' })
      return { type: 'done', synced: 4, failed: 0, errors: [] }
    })
    renderWithToolbar()
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByText(/Google Sync/))
    await waitFor(() =>
      expect(screen.getByText(/Synced 4 tasks to Google Tasks/)).toBeInTheDocument()
    )
  })
})
