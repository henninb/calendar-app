import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('@/components/ConfigPage', () => ({
  loadConfig: vi.fn(() => ({ gcalSyncDays: 365, gcalSyncForce: false, apiKey: '' })),
}))

vi.mock('@/lib/api', () => ({
  gcalAuthStatus:      vi.fn(),
  generateAll:         vi.fn(),
  syncToGcal:          vi.fn(),
  deleteAllGcalEvents: vi.fn(),
  wipeAllGcalEvents:   vi.fn(),
}))

import * as api from '@/lib/api'
import CalendarActions from '../CalendarActions'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: true, email: 'user@example.com' })
  vi.mocked(api.generateAll).mockResolvedValue({ occurrences_created: 4, events_processed: 2 })
  vi.mocked(api.syncToGcal).mockResolvedValue({ synced: 8, failed: 0, errors: [] })
  vi.mocked(api.deleteAllGcalEvents).mockResolvedValue({ message: 'Delete started.' })
  vi.mocked(api.wipeAllGcalEvents).mockResolvedValue({ message: 'Wipe started.' })
})

describe('CalendarActions — initial render', () => {
  it('renders Generate and Sync buttons', () => {
    render(<CalendarActions />)
    expect(screen.getByText(/Generate/)).toBeInTheDocument()
    expect(screen.getByText(/Sync|Connect/)).toBeInTheDocument()
  })

  it('calls gcalAuthStatus on mount', async () => {
    render(<CalendarActions />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalledTimes(1))
  })

  it('logs Google auth status after mount', async () => {
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Google auth status: authenticated/)).toBeInTheDocument()
    )
  })

  it('shows unauthenticated message when not authenticated', async () => {
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Google auth status: not authenticated/)).toBeInTheDocument()
    )
  })

  it('falls back to gcalAuth=false when gcalAuthStatus throws', async () => {
    vi.mocked(api.gcalAuthStatus).mockRejectedValue(new Error('Network down'))
    render(<CalendarActions />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    expect(screen.queryByText(/authenticated/)).not.toBeInTheDocument()
  })
})

describe('CalendarActions — Generate', () => {
  it('calls generateAll when Generate is clicked', async () => {
    render(<CalendarActions />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())

    fireEvent.click(screen.getByText(/⟳ Generate/))
    await waitFor(() => expect(api.generateAll).toHaveBeenCalledTimes(1))
  })

  it('logs success after Generate completes', async () => {
    render(<CalendarActions />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())

    fireEvent.click(screen.getByText(/⟳ Generate/))
    await waitFor(() =>
      expect(screen.getByText(/Generated 4 new occurrences/)).toBeInTheDocument()
    )
  })

  it('logs error when generateAll fails', async () => {
    vi.mocked(api.generateAll).mockRejectedValue(new Error('Generate failed'))
    render(<CalendarActions />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())

    fireEvent.click(screen.getByText(/⟳ Generate/))
    await waitFor(() =>
      expect(screen.getByText(/Generate failed: Generate failed/)).toBeInTheDocument()
    )
  })
})

describe('CalendarActions — Google Calendar sync', () => {
  it('calls syncToGcal when authenticated and Sync is clicked', async () => {
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Sync to Google Calendar/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Sync to Google Calendar/))
    await waitFor(() => expect(api.syncToGcal).toHaveBeenCalledTimes(1))
  })

  it('logs sync result after successful sync', async () => {
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Sync to Google Calendar/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Sync to Google Calendar/))
    await waitFor(() =>
      expect(screen.getByText(/Synced 8 events to Google Calendar/)).toBeInTheDocument()
    )
  })

  it('redirects to OAuth when not authenticated', async () => {
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    const locationMock = { href: '' }
    vi.stubGlobal('location', locationMock)

    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Connect Google/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Connect Google/))
    expect(locationMock.href).toBe('/api/sync/auth')

    vi.unstubAllGlobals()
  })

  it('logs warning when some events fail', async () => {
    vi.mocked(api.syncToGcal).mockResolvedValue({ synced: 5, failed: 2, errors: ['err1', 'err2'] })
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Sync to Google Calendar/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Sync to Google Calendar/))
    await waitFor(() =>
      expect(screen.getByText(/2 failed/)).toBeInTheDocument()
    )
  })

  it('logs quota error when quota exceeded', async () => {
    vi.mocked(api.syncToGcal).mockResolvedValue({
      synced: 0,
      failed: 1,
      errors: ['quotaExceeded: limit reached'],
    })
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Sync to Google Calendar/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Sync to Google Calendar/))
    await waitFor(() =>
      expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument()
    )
  })

  it('logs error when syncToGcal throws', async () => {
    vi.mocked(api.syncToGcal).mockRejectedValue(new Error('Sync error'))
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Sync to Google Calendar/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Sync to Google Calendar/))
    await waitFor(() =>
      expect(screen.getByText(/Google Calendar sync failed: Sync error/)).toBeInTheDocument()
    )
  })

  it('calls syncToGcal with progress callback and handles start/progress events', async () => {
    vi.mocked(api.syncToGcal).mockImplementation(async (_days, _force, onProgress) => {
      onProgress?.({ type: 'start', total: 3 })
      onProgress?.({ type: 'progress', msg: '1/3 done' })
      return { synced: 3, failed: 0, errors: [] }
    })
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Sync to Google Calendar/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Sync to Google Calendar/))
    await waitFor(() =>
      expect(screen.getByText(/Synced 3 events to Google Calendar/)).toBeInTheDocument()
    )
  })
})

describe('CalendarActions — Delete Google Cal', () => {
  it('calls deleteAllGcalEvents after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Clear Google Cal/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Clear Google Cal/))
    await waitFor(() => expect(api.deleteAllGcalEvents).toHaveBeenCalledTimes(1))
  })

  it('logs success message after delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Clear Google Cal/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Clear Google Cal/))
    await waitFor(() =>
      expect(screen.getByText(/Delete started\./)).toBeInTheDocument()
    )
  })

  it('does not call deleteAllGcalEvents when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Clear Google Cal/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Clear Google Cal/))
    expect(api.deleteAllGcalEvents).not.toHaveBeenCalled()
  })

  it('logs error when deleteAllGcalEvents fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(api.deleteAllGcalEvents).mockRejectedValue(new Error('Delete error'))
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Clear Google Cal/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Clear Google Cal/))
    await waitFor(() =>
      expect(screen.getByText(/Delete failed: Delete error/)).toBeInTheDocument()
    )
  })
})

describe('CalendarActions — Wipe Google Cal', () => {
  it('calls wipeAllGcalEvents after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Wipe Google Cal/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Wipe Google Cal/))
    await waitFor(() => expect(api.wipeAllGcalEvents).toHaveBeenCalledTimes(1))
  })

  it('logs success message after wipe', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Wipe Google Cal/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Wipe Google Cal/))
    await waitFor(() =>
      expect(screen.getByText(/Wipe started\./)).toBeInTheDocument()
    )
  })

  it('does not call wipeAllGcalEvents when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Wipe Google Cal/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Wipe Google Cal/))
    expect(api.wipeAllGcalEvents).not.toHaveBeenCalled()
  })

  it('logs error when wipeAllGcalEvents fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(api.wipeAllGcalEvents).mockRejectedValue(new Error('Wipe error'))
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Wipe Google Cal/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText(/Wipe Google Cal/))
    await waitFor(() =>
      expect(screen.getByText(/Wipe failed: Wipe error/)).toBeInTheDocument()
    )
  })
})

describe('CalendarActions — log panel', () => {
  it('shows log panel after any action', async () => {
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Google auth status/)).toBeInTheDocument()
    )
    expect(screen.getByLabelText('Clear activity log')).toBeInTheDocument()
  })

  it('clears log panel when close is clicked', async () => {
    render(<CalendarActions />)
    await waitFor(() =>
      expect(screen.getByText(/Google auth status/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByLabelText('Clear activity log'))
    expect(screen.queryByText(/Google auth status/)).not.toBeInTheDocument()
  })

  it('does not show delete/wipe buttons when not authenticated', async () => {
    vi.mocked(api.gcalAuthStatus).mockResolvedValue({ authenticated: false })
    render(<CalendarActions />)
    await waitFor(() => expect(api.gcalAuthStatus).toHaveBeenCalled())
    expect(screen.queryByText(/Clear Google Cal/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Wipe Google Cal/)).not.toBeInTheDocument()
  })
})
