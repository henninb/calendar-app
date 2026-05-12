import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

let mockPathname = '/calendar'

vi.mock('next/link', () => ({
  default: ({ href, children, className, title }: {
    href: string; children: React.ReactNode; className?: string; title?: string
  }) => <a href={href} className={className} title={title}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/components/ConfigPage', () => ({
  loadConfig: vi.fn(() => ({ gcalSyncDays: 365, gcalSyncForce: false, apiKey: '' })),
}))

vi.mock('@/lib/api', () => ({
  gcalAuthStatus:      vi.fn(),
  generateAll:         vi.fn(),
  syncToGcal:          vi.fn(),
  deleteAllGcalEvents: vi.fn(),
  wipeAllGcalEvents:   vi.fn(),
  syncToGtasks:        vi.fn(),
}))

import * as api from '@/lib/api'
import AppHeader from '../AppHeader'

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPathname = '/calendar'
  vi.stubGlobal('localStorage', localStorageMock)
  vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: true, email: 'user@example.com' })
  vi.mocked(api.generateAll).mockResolvedValue({ occurrences_created: 3, events_processed: 2 })
  vi.mocked(api.syncToGcal).mockResolvedValue({ synced: 7, failed: 0, errors: [] })
  vi.mocked(api.deleteAllGcalEvents).mockResolvedValue({ message: 'Delete started.' })
  vi.mocked(api.wipeAllGcalEvents).mockResolvedValue({ message: 'Wipe started.' })
  vi.mocked(api.syncToGtasks).mockResolvedValue({ synced: 5, failed: 0, errors: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppHeader — navigation', () => {
  it('renders all nav tabs', () => {
    render(<AppHeader />)
    expect(screen.getByTitle('Switch to 📅 Calendar view')).toBeInTheDocument()
    expect(screen.getByTitle('Switch to ✅ Tasks view')).toBeInTheDocument()
    expect(screen.getByTitle('Switch to 🛒 Grocery view')).toBeInTheDocument()
    expect(screen.getByTitle('Switch to ⚙️ Config view')).toBeInTheDocument()
  })

  it('renders the app title', () => {
    render(<AppHeader />)
    expect(screen.getByText(/Calendar App/)).toBeInTheDocument()
  })

  it('marks the active tab with "active" class', async () => {
    mockPathname = '/calendar'
    render(<AppHeader />)
    const calendarLink = screen.getByTitle('Switch to 📅 Calendar view')
    expect(calendarLink).toHaveClass('active')
  })
})

describe('AppHeader — dark mode toggle', () => {
  it('renders dark/light mode button', () => {
    render(<AppHeader />)
    expect(screen.getByTitle('Toggle dark/light mode')).toBeInTheDocument()
  })

  it('toggles button text when clicked', async () => {
    render(<AppHeader />)
    const btn = screen.getByTitle('Toggle dark/light mode')
    const initialText = btn.textContent
    fireEvent.click(btn)
    expect(btn.textContent).not.toBe(initialText)
  })
})

describe('AppHeader — calendar page buttons', () => {
  it('shows Generate button on calendar page', async () => {
    render(<AppHeader />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    expect(screen.getByTitle('Generate occurrences for all active events')).toBeInTheDocument()
  })

  it('shows Sync to Google Calendar button when authenticated', async () => {
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('📅 Sync to Google Calendar')).toBeInTheDocument()
    )
  })

  it('shows Connect Google button when not authenticated', async () => {
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('🔗 Connect Google')).toBeInTheDocument()
    )
  })

  it('shows Clear and Wipe buttons when authenticated on calendar page', async () => {
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('🗑 Clear Google Cal')).toBeInTheDocument()
    )
    expect(screen.getByText('💣 Wipe Google Cal')).toBeInTheDocument()
  })

  it('does not show Clear/Wipe buttons when not authenticated', async () => {
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    render(<AppHeader />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    expect(screen.queryByText('🗑 Clear Google Cal')).not.toBeInTheDocument()
    expect(screen.queryByText('💣 Wipe Google Cal')).not.toBeInTheDocument()
  })
})

describe('AppHeader — tasks page buttons', () => {
  it('shows Google Sync button on tasks page', async () => {
    mockPathname = '/tasks'
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('✅ Google Sync')).toBeInTheDocument()
    )
  })

  it('does not show calendar action buttons on tasks page', async () => {
    mockPathname = '/tasks'
    render(<AppHeader />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    expect(screen.queryByTitle('Generate occurrences for all active events')).not.toBeInTheDocument()
  })
})

describe('AppHeader — Generate action', () => {
  it('calls generateAll when Generate is clicked', async () => {
    render(<AppHeader />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByTitle('Generate occurrences for all active events'))
    await waitFor(() => expect(api.generateAll).toHaveBeenCalledTimes(1))
  })

  it('logs success after Generate completes', async () => {
    render(<AppHeader />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByTitle('Generate occurrences for all active events'))
    await waitFor(() =>
      expect(screen.getByText(/Generated 3 new occurrences/)).toBeInTheDocument()
    )
  })

  it('logs error when generateAll fails', async () => {
    vi.mocked(api.generateAll).mockRejectedValue(new Error('Generate error'))
    render(<AppHeader />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByTitle('Generate occurrences for all active events'))
    await waitFor(() =>
      expect(screen.getByText(/Generate failed: Generate error/)).toBeInTheDocument()
    )
  })
})

describe('AppHeader — Gcal sync', () => {
  it('calls syncToGcal when authenticated', async () => {
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('📅 Sync to Google Calendar')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('📅 Sync to Google Calendar'))
    await waitFor(() => expect(api.syncToGcal).toHaveBeenCalledTimes(1))
  })

  it('logs success after sync', async () => {
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('📅 Sync to Google Calendar')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('📅 Sync to Google Calendar'))
    await waitFor(() =>
      expect(screen.getByText(/Synced 7 events to Google Calendar/)).toBeInTheDocument()
    )
  })

  it('redirects to OAuth when not authenticated', async () => {
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    const locationMock = { href: '' }
    vi.stubGlobal('location', locationMock)

    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('🔗 Connect Google')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('🔗 Connect Google'))
    expect(locationMock.href).toBe('/api/sync/auth')

    vi.unstubAllGlobals()
  })

  it('logs error when syncToGcal throws', async () => {
    vi.mocked(api.syncToGcal).mockRejectedValue(new Error('Sync down'))
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('📅 Sync to Google Calendar')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('📅 Sync to Google Calendar'))
    await waitFor(() =>
      expect(screen.getByText(/Google Calendar sync failed: Sync down/)).toBeInTheDocument()
    )
  })

  it('logs quota exceeded warning', async () => {
    vi.mocked(api.syncToGcal).mockResolvedValue({
      synced: 0,
      failed: 1,
      errors: ['quotaExceeded: limit'],
    })
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('📅 Sync to Google Calendar')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('📅 Sync to Google Calendar'))
    await waitFor(() =>
      expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument()
    )
  })

  it('calls syncToGcal progress callback for start and progress events', async () => {
    vi.mocked(api.syncToGcal).mockImplementation(async (_d, _f, onProgress) => {
      onProgress?.({ type: 'start', total: 5 })
      onProgress?.({ type: 'progress', msg: '2/5' })
      return { synced: 5, failed: 0, errors: [] }
    })
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('📅 Sync to Google Calendar')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('📅 Sync to Google Calendar'))
    await waitFor(() =>
      expect(screen.getByText(/Synced 5 events/)).toBeInTheDocument()
    )
  })
})

describe('AppHeader — Delete Google Cal', () => {
  it('calls deleteAllGcalEvents after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('🗑 Clear Google Cal')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('🗑 Clear Google Cal'))
    await waitFor(() => expect(api.deleteAllGcalEvents).toHaveBeenCalledTimes(1))
  })

  it('does not call deleteAllGcalEvents when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('🗑 Clear Google Cal')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('🗑 Clear Google Cal'))
    expect(api.deleteAllGcalEvents).not.toHaveBeenCalled()
  })

  it('logs error when deleteAllGcalEvents fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(api.deleteAllGcalEvents).mockRejectedValue(new Error('Delete error'))
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('🗑 Clear Google Cal')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('🗑 Clear Google Cal'))
    await waitFor(() =>
      expect(screen.getByText(/Delete failed: Delete error/)).toBeInTheDocument()
    )
  })
})

describe('AppHeader — Wipe Google Cal', () => {
  it('calls wipeAllGcalEvents after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('💣 Wipe Google Cal')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('💣 Wipe Google Cal'))
    await waitFor(() => expect(api.wipeAllGcalEvents).toHaveBeenCalledTimes(1))
  })

  it('logs error when wipeAllGcalEvents fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(api.wipeAllGcalEvents).mockRejectedValue(new Error('Wipe error'))
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('💣 Wipe Google Cal')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('💣 Wipe Google Cal'))
    await waitFor(() =>
      expect(screen.getByText(/Wipe failed: Wipe error/)).toBeInTheDocument()
    )
  })
})

describe('AppHeader — Google Tasks sync', () => {
  it('calls syncToGtasks when authenticated on tasks page', async () => {
    mockPathname = '/tasks'
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('✅ Google Sync')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('✅ Google Sync'))
    await waitFor(() => expect(api.syncToGtasks).toHaveBeenCalledTimes(1))
  })

  it('logs success after Gtasks sync', async () => {
    mockPathname = '/tasks'
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('✅ Google Sync')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('✅ Google Sync'))
    await waitFor(() =>
      expect(screen.getByText(/Synced 5 tasks to Google Tasks/)).toBeInTheDocument()
    )
  })

  it('redirects to OAuth when not authenticated on tasks page', async () => {
    mockPathname = '/tasks'
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    const locationMock = { href: '' }
    vi.stubGlobal('location', locationMock)

    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('✅ Google Sync')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('✅ Google Sync'))
    expect(locationMock.href).toBe('/api/sync/auth')

    vi.unstubAllGlobals()
  })

  it('logs error when syncToGtasks fails', async () => {
    mockPathname = '/tasks'
    vi.mocked(api.syncToGtasks).mockRejectedValue(new Error('Tasks error'))
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('✅ Google Sync')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('✅ Google Sync'))
    await waitFor(() =>
      expect(screen.getByText(/Google Tasks sync failed: Tasks error/)).toBeInTheDocument()
    )
  })

  it('logs quota warning on Gtasks quota exceeded error', async () => {
    mockPathname = '/tasks'
    vi.mocked(api.syncToGtasks).mockResolvedValue({
      synced: 0,
      failed: 1,
      errors: ['Quota Exceeded: daily limit'],
    })
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText('✅ Google Sync')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('✅ Google Sync'))
    await waitFor(() =>
      expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument()
    )
  })
})

describe('AppHeader — log panel', () => {
  it('shows log panel after auth status is loaded', async () => {
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText(/Google auth status/)).toBeInTheDocument()
    )
  })

  it('clears the log panel when ✕ is clicked', async () => {
    render(<AppHeader />)
    await waitFor(() =>
      expect(screen.getByText(/Google auth status/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByLabelText('Clear activity log'))
    expect(screen.queryByText(/Google auth status/)).not.toBeInTheDocument()
  })
})
