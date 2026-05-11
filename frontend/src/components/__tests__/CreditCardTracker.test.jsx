import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CreditCardTracker from '../CreditCardTracker'

vi.mock('../../api', () => ({
  fetchCreditCardTracker: vi.fn(),
  createCreditCard:       vi.fn(),
}))

import * as api from '../../api'

const BASE_ROW = {
  id: 1,
  name: 'Chase Sapphire',
  last_four: '1234',
  issuer: 'Chase',
  grace: 25,
  prev_close: '2099-05-01',
  prev_due: '2099-05-25',
  prev_due_overdue: false,
  next_close: '2099-06-01',
  next_close_days: 21,
  next_due: '2099-06-25',
  next_due_days: 45,
  annual_fee_date: null,
  annual_fee_days: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchCreditCardTracker.mockResolvedValue([BASE_ROW])
  api.createCreditCard.mockResolvedValue({})
})

// ── rendering ─────────────────────────────────────────────────────────────────

describe('CreditCardTracker — rendering', () => {
  it('shows loading state initially', () => {
    api.fetchCreditCardTracker.mockReturnValue(new Promise(() => {}))
    render(<CreditCardTracker />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders card name after loading', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => expect(screen.getByText('Chase Sapphire')).toBeInTheDocument())
  })

  it('renders last-four digits', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => expect(screen.getByText('(1234)')).toBeInTheDocument())
  })

  it('renders error message when fetch fails', async () => {
    api.fetchCreditCardTracker.mockRejectedValue(new Error('Network failure'))
    render(<CreditCardTracker />)
    await waitFor(() => expect(screen.getByText(/Failed to load credit cards/)).toBeInTheDocument())
  })

  it('shows empty state when no cards returned', async () => {
    api.fetchCreditCardTracker.mockResolvedValue([])
    render(<CreditCardTracker />)
    await waitFor(() => expect(screen.getByText(/No credit cards found/)).toBeInTheDocument())
  })

  it('renders table headers', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => {
      expect(screen.getByText('Card')).toBeInTheDocument()
      expect(screen.getByText('Next Due')).toBeInTheDocument()
      expect(screen.getByText('Next Close')).toBeInTheDocument()
    })
  })

  it('shows overdue warning icon when prev_due_overdue is true', async () => {
    api.fetchCreditCardTracker.mockResolvedValue([{ ...BASE_ROW, prev_due_overdue: true }])
    render(<CreditCardTracker />)
    await waitFor(() => expect(screen.getByText('⚠')).toBeInTheDocument())
  })
})

// ── Refresh button ────────────────────────────────────────────────────────────

describe('CreditCardTracker — Refresh', () => {
  it('clicking Refresh re-fetches data', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => screen.getByText('Chase Sapphire'))
    fireEvent.click(screen.getByTitle('Reload credit card billing dates from the server'))
    await waitFor(() => expect(api.fetchCreditCardTracker).toHaveBeenCalledTimes(2))
  })
})

// ── Add Card form ─────────────────────────────────────────────────────────────

describe('CreditCardTracker — add card form', () => {
  it('form is hidden by default', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => screen.getByText('Chase Sapphire'))
    expect(screen.queryByPlaceholderText('e.g. Chase Sapphire')).not.toBeInTheDocument()
  })

  it('clicking "+ Add Card" shows the form', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => screen.getByTitle('Add a new credit card'))
    fireEvent.click(screen.getByTitle('Add a new credit card'))
    expect(screen.getByPlaceholderText('e.g. Chase Sapphire')).toBeInTheDocument()
  })

  it('clicking Cancel (form button) hides the form', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => screen.getByTitle('Add a new credit card'))
    fireEvent.click(screen.getByTitle('Add a new credit card'))
    // Two "Cancel" texts: the toggle button and the form's cancel button — click the form one.
    const cancelBtns = screen.getAllByText('Cancel')
    fireEvent.click(cancelBtns[cancelBtns.length - 1])
    expect(screen.queryByPlaceholderText('e.g. Chase Sapphire')).not.toBeInTheDocument()
  })

  it('shows error when submitting without a name', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => screen.getByTitle('Add a new credit card'))
    fireEvent.click(screen.getByTitle('Add a new credit card'))
    fireEvent.click(screen.getByText('Save Card'))
    expect(screen.getByText('Name is required.')).toBeInTheDocument()
  })

  it('calls createCreditCard with the name when form is submitted', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => screen.getByTitle('Add a new credit card'))
    fireEvent.click(screen.getByTitle('Add a new credit card'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Chase Sapphire'), {
      target: { value: 'Amex Gold' },
    })
    fireEvent.click(screen.getByText('Save Card'))
    await waitFor(() =>
      expect(api.createCreditCard).toHaveBeenCalledWith(expect.objectContaining({ name: 'Amex Gold' }))
    )
  })

  it('hides the form after successful save', async () => {
    render(<CreditCardTracker />)
    await waitFor(() => screen.getByTitle('Add a new credit card'))
    fireEvent.click(screen.getByTitle('Add a new credit card'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Chase Sapphire'), {
      target: { value: 'Amex Gold' },
    })
    fireEvent.click(screen.getByText('Save Card'))
    await waitFor(() => expect(screen.queryByPlaceholderText('e.g. Chase Sapphire')).not.toBeInTheDocument())
  })

  it('shows formError when createCreditCard rejects', async () => {
    api.createCreditCard.mockRejectedValue(new Error('Duplicate card'))
    render(<CreditCardTracker />)
    await waitFor(() => screen.getByTitle('Add a new credit card'))
    fireEvent.click(screen.getByTitle('Add a new credit card'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Chase Sapphire'), {
      target: { value: 'Amex Gold' },
    })
    fireEvent.click(screen.getByText('Save Card'))
    await waitFor(() => expect(screen.getByText('Duplicate card')).toBeInTheDocument())
  })
})
