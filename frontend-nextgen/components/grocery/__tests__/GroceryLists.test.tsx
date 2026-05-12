import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import GroceryLists from '../GroceryLists'

vi.mock('@/lib/api', () => ({
  fetchGroceryLists: vi.fn(),
  createGroceryList: vi.fn(),
  updateGroceryList: vi.fn(),
  deleteGroceryList: vi.fn(),
}))

import * as api from '@/lib/api'

const STORES = [{ id: 1, name: 'ALDI', location: 'Coon Rapids, MN' }]

const LISTS = [
  {
    id: 1,
    name: 'Weekly Run',
    status: 'active',
    store: { id: 1, name: 'ALDI' },
    shopping_date: '2026-05-10',
    items: [{ id: 1, status: 'needed' }, { id: 2, status: 'purchased' }],
  },
  {
    id: 2,
    name: 'Quick Trip',
    status: 'draft',
    store: null,
    shopping_date: null,
    items: [],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.mocked(api.fetchGroceryLists).mockResolvedValue(LISTS)
  vi.mocked(api.createGroceryList).mockResolvedValue({
    id: 3, name: 'New List', status: 'draft', store: null, shopping_date: null, items: [],
  })
  vi.mocked(api.deleteGroceryList).mockResolvedValue(null)
})

describe('GroceryLists — loading', () => {
  it('shows loading indicator while fetching', () => {
    vi.mocked(api.fetchGroceryLists).mockImplementation(() => new Promise(() => {}))
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    expect(screen.getByText(/Loading lists/)).toBeInTheDocument()
  })
})

describe('GroceryLists — with data', () => {
  it('renders all list names after loading', async () => {
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText('Weekly Run')).toBeInTheDocument())
    expect(screen.getByText('Quick Trip')).toBeInTheDocument()
  })

  it('shows status badges for each list', async () => {
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText('Weekly Run')).toBeInTheDocument())
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Draft').length).toBeGreaterThanOrEqual(2)
  })

  it('shows store name on list card', async () => {
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText(/ALDI/)).toBeInTheDocument())
  })

  it('shows item count on list card', async () => {
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText(/2 items · 1 purchased/)).toBeInTheDocument())
  })
})

describe('GroceryLists — empty state', () => {
  it('shows empty message when no lists', async () => {
    vi.mocked(api.fetchGroceryLists).mockResolvedValue([])
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText(/No shopping lists yet/)).toBeInTheDocument())
  })
})

describe('GroceryLists — status filter', () => {
  it('filters to only draft lists when Draft is clicked', async () => {
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText('Weekly Run')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }))
    expect(screen.queryByText('Weekly Run')).not.toBeInTheDocument()
    expect(screen.getByText('Quick Trip')).toBeInTheDocument()
  })

  it('shows filtered empty message when no lists match the selected status', async () => {
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText('Weekly Run')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    expect(screen.getByText('No completed lists.')).toBeInTheDocument()
  })

  it('shows all lists again when All is clicked after filtering', async () => {
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText('Weekly Run')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Weekly Run')).toBeInTheDocument()
    expect(screen.getByText('Quick Trip')).toBeInTheDocument()
  })
})

describe('GroceryLists — delete', () => {
  it('calls deleteGroceryList after confirm and removes list from view', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText('Weekly Run')).toBeInTheDocument())
    fireEvent.click(screen.getAllByTitle('Delete list')[0])
    await waitFor(() => expect(api.deleteGroceryList).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByText('Weekly Run')).not.toBeInTheDocument())
  })

  it('does not call deleteGroceryList when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText('Weekly Run')).toBeInTheDocument())
    fireEvent.click(screen.getAllByTitle('Delete list')[0])
    expect(api.deleteGroceryList).not.toHaveBeenCalled()
  })
})

describe('GroceryLists — error state', () => {
  it('shows error banner when fetch fails', async () => {
    vi.mocked(api.fetchGroceryLists).mockRejectedValue(new Error('Network error'))
    render(<GroceryLists stores={STORES} catalogItems={[]} />)
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument())
  })
})
