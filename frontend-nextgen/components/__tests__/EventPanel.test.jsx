import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EventPanel from '../EventPanel'

const CATS = [
  { id: 1, name: 'bills',   icon: '💰', color: '#3b82f6' },
  { id: 2, name: 'health',  icon: '🏥', color: '#10b981' },
]

function renderPanel(props = {}) {
  const onClose       = vi.fn()
  const onCreateEvent = vi.fn().mockResolvedValue(undefined)
  render(
    <EventPanel
      open={true}
      onClose={onClose}
      onCreateEvent={onCreateEvent}
      categories={CATS}
      {...props}
    />
  )
  return { onClose, onCreateEvent }
}

// ── rendering ─────────────────────────────────────────────────────────────────

describe('EventPanel — rendering', () => {
  it('renders "New Event" heading when open', () => {
    renderPanel()
    expect(screen.getByText('New Event')).toBeInTheDocument()
  })

  it('does not render panel content when closed', () => {
    renderPanel({ open: false })
    expect(screen.queryByText('Create Event')).toBeInTheDocument()
  })

  it('renders category options from the categories prop', () => {
    renderPanel()
    expect(screen.getByText('💰 bills')).toBeInTheDocument()
    expect(screen.getByText('🏥 health')).toBeInTheDocument()
  })

  it('renders all recurrence options', () => {
    renderPanel()
    expect(screen.getByText('One-time')).toBeInTheDocument()
    expect(screen.getByText('Daily')).toBeInTheDocument()
    expect(screen.getByText('Weekly')).toBeInTheDocument()
    expect(screen.getByText('Monthly')).toBeInTheDocument()
    expect(screen.getByText('Yearly')).toBeInTheDocument()
  })

  it('does NOT show "Repeat Until" field when recurrence is one-time', () => {
    renderPanel()
    expect(screen.queryByText(/Repeat Until/i)).not.toBeInTheDocument()
  })

  it('shows "Repeat Until" field when a recurrence is selected', () => {
    renderPanel()
    const select = screen.getAllByRole('combobox')[1]
    fireEvent.change(select, { target: { value: 'FREQ=WEEKLY' } })
    expect(screen.getByText(/Repeat Until/i)).toBeInTheDocument()
  })
})

// ── close behaviour ───────────────────────────────────────────────────────────

describe('EventPanel — close', () => {
  it('clicking ✕ calls onClose', () => {
    const { onClose } = renderPanel()
    const closeBtn = screen.getAllByRole('button').find(b => b.textContent === '✕')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the Cancel button calls onClose', () => {
    const { onClose } = renderPanel()
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('pressing Escape calls onClose', () => {
    const { onClose } = renderPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape does NOT call onClose when panel is closed', () => {
    const { onClose } = renderPanel({ open: false })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ── validation ────────────────────────────────────────────────────────────────

describe('EventPanel — validation', () => {
  it('Create Event button is disabled when title is empty', () => {
    renderPanel()
    const btn = screen.getByText('Create Event').closest('button')
    expect(btn).toBeDisabled()
  })

  it('Create Event button is enabled when title is filled', () => {
    renderPanel()
    fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: 'My Event' } })
    const btn = screen.getByText('Create Event').closest('button')
    expect(btn).not.toBeDisabled()
  })

  it('shows error when saving without selecting a category', async () => {
    renderPanel()
    fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: 'Test' } })
    fireEvent.click(screen.getByText('Create Event'))
    await waitFor(() => expect(screen.getByText('Please select a category.')).toBeInTheDocument())
  })
})

// ── successful save ───────────────────────────────────────────────────────────

describe('EventPanel — save', () => {
  it('calls onCreateEvent with correct payload', async () => {
    const { onCreateEvent } = renderPanel()
    fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: 'Pay Rent' } })
    const catSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(catSelect, { target: { value: '1' } })
    fireEvent.click(screen.getByText('Create Event'))
    await waitFor(() => {
      expect(onCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Pay Rent',
        category_id: 1,
        rrule: null,
      }))
    })
  })

  it('shows error message when onCreateEvent rejects', async () => {
    const onCreateEvent = vi.fn().mockRejectedValue(new Error('Server error'))
    renderPanel({ onCreateEvent })
    fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: 'Pay Rent' } })
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.click(screen.getByText('Create Event'))
    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument())
  })

  it('pressing Enter in the title field triggers save', async () => {
    const { onCreateEvent } = renderPanel()
    fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: 'Pay Rent' } })
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Event title'), { key: 'Enter' })
    await waitFor(() => expect(onCreateEvent).toHaveBeenCalled())
  })

  it('form resets when panel is re-opened', () => {
    const { rerender } = render(
      <EventPanel open={false} onClose={vi.fn()} onCreateEvent={vi.fn()} categories={CATS} />
    )
    rerender(
      <EventPanel open={true} onClose={vi.fn()} onCreateEvent={vi.fn()} categories={CATS} />
    )
    expect(screen.getByPlaceholderText('Event title').value).toBe('')
  })
})
