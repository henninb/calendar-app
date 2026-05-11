import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CalendarView from '../CalendarView'

// Mock FullCalendar — jsdom has no layout engine so FullCalendar can't render.
// We expose a fake `datesSet` trigger so tests can simulate calendar navigation.
let capturedDatesSet = null
vi.mock('@fullcalendar/react', () => ({
  default: ({ datesSet, eventClick, events }) => {
    capturedDatesSet = datesSet
    return (
      <div data-testid="fullcalendar">
        {events.map(e => (
          <button
            key={e.id}
            data-testid={`event-${e.id}`}
            onClick={() => eventClick && eventClick({ event: { extendedProps: e.extendedProps } })}
          >
            {e.title}
          </button>
        ))}
      </div>
    )
  },
}))
vi.mock('@fullcalendar/daygrid',      () => ({ default: {} }))
vi.mock('@fullcalendar/list',         () => ({ default: {} }))
vi.mock('@fullcalendar/interaction',  () => ({ default: {} }))

vi.mock('../../api', () => ({
  fetchOccurrences:  vi.fn(),
  fetchCategories:   vi.fn(),
  updateOccurrence:  vi.fn(),
  deleteOccurrence:  vi.fn(),
  createEvent:       vi.fn(),
}))

// Mock EventPanel so tests don't need to deal with its internals.
vi.mock('../EventPanel', () => ({
  default: ({ open, onClose }) =>
    open ? <div data-testid="event-panel"><button onClick={onClose}>ClosePanel</button></div> : null,
}))

import * as api from '../../api'

const CATS = [{ id: 1, name: 'bills', color: '#3b82f6' }]

const BASE_OCC = {
  id: 10,
  occurrence_date: '2099-06-15',
  status: 'upcoming',
  event: {
    title: 'Pay Rent',
    category: { name: 'bills' },
    description: null,
    amount: null,
    reminder_days: [],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedDatesSet = null
  api.fetchCategories.mockResolvedValue(CATS)
  api.fetchOccurrences.mockResolvedValue([BASE_OCC])
  api.updateOccurrence.mockResolvedValue({ ...BASE_OCC, status: 'completed' })
  api.deleteOccurrence.mockResolvedValue(null)
  api.createEvent.mockResolvedValue({})
})

async function triggerDatesSet() {
  await waitFor(() => expect(capturedDatesSet).not.toBeNull())
  capturedDatesSet({ startStr: '2099-06-01T00:00:00', endStr: '2099-07-01T00:00:00' })
}

// ── rendering ─────────────────────────────────────────────────────────────────

describe('CalendarView — rendering', () => {
  it('renders the FullCalendar stub', () => {
    render(<CalendarView />)
    expect(screen.getByTestId('fullcalendar')).toBeInTheDocument()
  })

  it('renders category filter buttons after categories load', async () => {
    render(<CalendarView />)
    await waitFor(() => expect(screen.getByText('bills')).toBeInTheDocument())
  })

  it('always renders the "all" filter button', () => {
    render(<CalendarView />)
    expect(screen.getByTitle('Show events from all categories')).toBeInTheDocument()
  })

  it('renders event titles after datesSet fires', async () => {
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => expect(screen.getByText('Pay Rent')).toBeInTheDocument())
  })

  it('renders the FAB new-event button', () => {
    render(<CalendarView />)
    expect(screen.getByTitle('New event')).toBeInTheDocument()
  })
})

// ── category filter ───────────────────────────────────────────────────────────

describe('CalendarView — category filter', () => {
  it('clicking a category button applies filter (event disappears for other category)', async () => {
    const occ2 = { ...BASE_OCC, id: 11, event: { ...BASE_OCC.event, title: 'Gym', category: { name: 'health' } } }
    api.fetchOccurrences.mockResolvedValue([BASE_OCC, occ2])
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => expect(screen.getByText('Pay Rent')).toBeInTheDocument())

    const billsBtn = screen.getByText('bills')
    fireEvent.click(billsBtn)
    // 'Gym' (health category) is filtered out
    expect(screen.queryByText('Gym')).not.toBeInTheDocument()
    expect(screen.getByText('Pay Rent')).toBeInTheDocument()
  })

  it('clicking the same category button again clears the filter', async () => {
    const occ2 = { ...BASE_OCC, id: 11, event: { ...BASE_OCC.event, title: 'Gym', category: { name: 'health' } } }
    api.fetchOccurrences.mockResolvedValue([BASE_OCC, occ2])
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => screen.getByText('bills'))

    const billsBtn = screen.getByText('bills')
    fireEvent.click(billsBtn)  // filter on bills
    fireEvent.click(billsBtn)  // toggle off
    expect(screen.getByText('Pay Rent')).toBeInTheDocument()
  })

  it('clicking the "all" button clears any active filter', async () => {
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => screen.getByText('bills'))

    fireEvent.click(screen.getByText('bills'))
    fireEvent.click(screen.getByTitle('Show events from all categories'))
    expect(screen.getByText('Pay Rent')).toBeInTheDocument()
  })
})

// ── detail panel ──────────────────────────────────────────────────────────────

describe('CalendarView — detail panel', () => {
  async function openDetail() {
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => screen.getByText('Pay Rent'))
    fireEvent.click(screen.getByText('Pay Rent'))
    await waitFor(() => screen.getByText('✓ Done'))
  }

  it('opens the detail panel when an event is clicked', async () => {
    await openDetail()
    expect(screen.getByText('✓ Done')).toBeInTheDocument()
  })

  it('closes the panel when the overlay is clicked', async () => {
    await openDetail()
    fireEvent.click(screen.getByClassName ? document.querySelector('.detail-overlay') : document.querySelector('.detail-overlay'))
    await waitFor(() => expect(screen.queryByText('✓ Done')).not.toBeInTheDocument())
  })

  it('closes the panel on Escape key', async () => {
    await openDetail()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('✓ Done')).not.toBeInTheDocument())
  })

  it('clicking ✓ Done calls updateOccurrence with completed', async () => {
    await openDetail()
    fireEvent.click(screen.getByText('✓ Done'))
    await waitFor(() => expect(api.updateOccurrence).toHaveBeenCalledWith(10, { status: 'completed' }))
  })

  it('clicking Skip calls updateOccurrence with skipped', async () => {
    await openDetail()
    api.updateOccurrence.mockResolvedValue({ ...BASE_OCC, status: 'skipped' })
    fireEvent.click(screen.getByText('Skip'))
    await waitFor(() => expect(api.updateOccurrence).toHaveBeenCalledWith(10, { status: 'skipped' }))
  })

  it('shows Reopen button when status is not upcoming', async () => {
    api.fetchOccurrences.mockResolvedValue([{ ...BASE_OCC, status: 'completed' }])
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => screen.getByText('Pay Rent'))
    fireEvent.click(screen.getByText('Pay Rent'))
    await waitFor(() => expect(screen.getByText('Reopen')).toBeInTheDocument())
  })

  it('shows error when updateOccurrence fails', async () => {
    api.updateOccurrence.mockRejectedValue(new Error('Update failed'))
    await openDetail()
    fireEvent.click(screen.getByText('✓ Done'))
    await waitFor(() => expect(screen.getByText(/Failed to update status/)).toBeInTheDocument())
  })
})

// ── delete ────────────────────────────────────────────────────────────────────

describe('CalendarView — delete', () => {
  it('calls deleteOccurrence when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => screen.getByText('Pay Rent'))
    fireEvent.click(screen.getByText('Pay Rent'))
    await waitFor(() => screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(api.deleteOccurrence).toHaveBeenCalledWith(10))
  })

  it('does NOT call deleteOccurrence when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => screen.getByText('Pay Rent'))
    fireEvent.click(screen.getByText('Pay Rent'))
    await waitFor(() => screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete'))
    expect(api.deleteOccurrence).not.toHaveBeenCalled()
  })

  it('closes the panel after successful delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CalendarView />)
    await triggerDatesSet()
    await waitFor(() => screen.getByText('Pay Rent'))
    fireEvent.click(screen.getByText('Pay Rent'))
    await waitFor(() => screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(screen.queryByText('✓ Done')).not.toBeInTheDocument())
  })
})

// ── FAB / EventPanel ──────────────────────────────────────────────────────────

describe('CalendarView — FAB and EventPanel', () => {
  it('clicking FAB opens EventPanel', () => {
    render(<CalendarView />)
    fireEvent.click(screen.getByTitle('New event'))
    expect(screen.getByTestId('event-panel')).toBeInTheDocument()
  })

  it('closing EventPanel from inside hides it', () => {
    render(<CalendarView />)
    fireEvent.click(screen.getByTitle('New event'))
    fireEvent.click(screen.getByText('ClosePanel'))
    expect(screen.queryByTestId('event-panel')).not.toBeInTheDocument()
  })
})
