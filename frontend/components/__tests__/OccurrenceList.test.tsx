import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import OccurrenceList from '../OccurrenceList'

vi.mock('@/lib/api', () => ({
  fetchOccurrences:         vi.fn(),
  fetchCategories:          vi.fn(),
  updateOccurrence:         vi.fn(),
  createTaskFromOccurrence: vi.fn(),
}))

import * as api from '@/lib/api'

const CATS = [{ id: 1, name: 'bills', icon: '💰', color: '#3b82f6' }]

const BASE_OCC = {
  id: 10,
  occurrence_date: '2099-06-15',
  status: 'upcoming',
  event: { title: 'Pay Rent', category: { name: 'bills' }, priority: 'high' },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchCategories).mockResolvedValue(CATS)
  vi.mocked(api.fetchOccurrences).mockResolvedValue([BASE_OCC])
})

// ── rendering ─────────────────────────────────────────────────────────────────

describe('OccurrenceList — rendering', () => {
  it('shows loading state initially', () => {
    vi.mocked(api.fetchOccurrences).mockReturnValue(new Promise(() => {}))
    render(<OccurrenceList />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders occurrence rows after loading', async () => {
    render(<OccurrenceList />)
    await waitFor(() => expect(screen.getByText('Pay Rent')).toBeInTheDocument())
  })

  it('shows "No occurrences found" when list is empty', async () => {
    vi.mocked(api.fetchOccurrences).mockResolvedValue([])
    render(<OccurrenceList />)
    await waitFor(() => expect(screen.getByText('No occurrences found.')).toBeInTheDocument())
  })

  it('renders status badge', async () => {
    render(<OccurrenceList />)
    await waitFor(() => expect(screen.getByText('upcoming')).toBeInTheDocument())
  })

  it('renders category badge', async () => {
    render(<OccurrenceList />)
    await waitFor(() => expect(screen.getByText('bills')).toBeInTheDocument())
  })
})

// ── filters ───────────────────────────────────────────────────────────────────

describe('OccurrenceList — filters', () => {
  it('changing the days-ahead select triggers a reload', async () => {
    render(<OccurrenceList />)
    await waitFor(() => expect(api.fetchOccurrences).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByDisplayValue('60'), { target: { value: '30' } })
    await waitFor(() => expect(api.fetchOccurrences).toHaveBeenCalledTimes(2))
  })

  it('changing category select triggers reload', async () => {
    render(<OccurrenceList />)
    await waitFor(() => expect(api.fetchOccurrences).toHaveBeenCalledTimes(1))
    const catSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(catSelect, { target: { value: '1' } })
    await waitFor(() => expect(api.fetchOccurrences).toHaveBeenCalledTimes(2))
  })

  it('Refresh button triggers reload', async () => {
    render(<OccurrenceList />)
    await waitFor(() => expect(api.fetchOccurrences).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => expect(api.fetchOccurrences).toHaveBeenCalledTimes(2))
  })
})

// ── mark status ───────────────────────────────────────────────────────────────

describe('OccurrenceList — mark status', () => {
  it('clicking ✓ calls updateOccurrence with completed', async () => {
    vi.mocked(api.updateOccurrence).mockResolvedValue({ ...BASE_OCC, status: 'completed' })
    render(<OccurrenceList />)
    await waitFor(() => screen.getByTitle('Mark as completed'))
    fireEvent.click(screen.getByTitle('Mark as completed'))
    await waitFor(() => expect(api.updateOccurrence).toHaveBeenCalledWith(10, { status: 'completed' }))
  })

  it('clicking Skip calls updateOccurrence with skipped', async () => {
    vi.mocked(api.updateOccurrence).mockResolvedValue({ ...BASE_OCC, status: 'skipped' })
    render(<OccurrenceList />)
    await waitFor(() => screen.getByTitle('Mark as skipped'))
    fireEvent.click(screen.getByTitle('Mark as skipped'))
    await waitFor(() => expect(api.updateOccurrence).toHaveBeenCalledWith(10, { status: 'skipped' }))
  })

  it('shows Reopen button for completed occurrence', async () => {
    vi.mocked(api.fetchOccurrences).mockResolvedValue([{ ...BASE_OCC, status: 'completed' }])
    render(<OccurrenceList />)
    await waitFor(() => screen.getByDisplayValue('Upcoming + Overdue'))
    fireEvent.change(screen.getByDisplayValue('Upcoming + Overdue'), { target: { value: 'completed' } })
    await waitFor(() => expect(screen.getByTitle('Reopen as upcoming')).toBeInTheDocument())
  })

  it('does NOT show ✓ button for already-completed occurrence', async () => {
    vi.mocked(api.fetchOccurrences).mockResolvedValue([{ ...BASE_OCC, status: 'completed' }])
    render(<OccurrenceList />)
    await waitFor(() => screen.getByDisplayValue('Upcoming + Overdue'))
    fireEvent.change(screen.getByDisplayValue('Upcoming + Overdue'), { target: { value: 'completed' } })
    await waitFor(() => screen.getByText('completed'))
    expect(screen.queryByTitle('Mark as completed')).not.toBeInTheDocument()
  })
})

// ── create task ───────────────────────────────────────────────────────────────

describe('OccurrenceList — create task', () => {
  it('shows "→ Task" button for upcoming occurrences', async () => {
    render(<OccurrenceList />)
    await waitFor(() => expect(screen.getByTitle('Create a task from this occurrence')).toBeInTheDocument())
  })

  it('clicking "→ Task" calls createTaskFromOccurrence', async () => {
    vi.mocked(api.createTaskFromOccurrence).mockResolvedValue({})
    render(<OccurrenceList />)
    await waitFor(() => screen.getByTitle('Create a task from this occurrence'))
    fireEvent.click(screen.getByTitle('Create a task from this occurrence'))
    await waitFor(() => expect(api.createTaskFromOccurrence).toHaveBeenCalledWith(10))
  })

  it('shows "✓ Task" after task is created', async () => {
    vi.mocked(api.createTaskFromOccurrence).mockResolvedValue({})
    render(<OccurrenceList />)
    await waitFor(() => screen.getByTitle('Create a task from this occurrence'))
    fireEvent.click(screen.getByTitle('Create a task from this occurrence'))
    await waitFor(() => expect(screen.getByText(/✓ Task/)).toBeInTheDocument())
  })
})
