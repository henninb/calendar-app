import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import OnHandView from '../OnHandView'

vi.mock('@/lib/api', () => ({
  fetchOnHand:       vi.fn(),
  upsertOnHand:      vi.fn(),
  deleteOnHand:      vi.fn(),
  createGroceryItem: vi.fn(),
  updateGroceryItem: vi.fn(),
  deleteGroceryItem: vi.fn(),
}))

import * as api from '@/lib/api'

const STORES = [{ id: 1, name: 'ALDI' }]

const CATALOG_ITEMS = [
  { id: 1, name: 'Apples',  default_unit: 'each', default_store_id: 1,    default_store: { name: 'ALDI' } },
  { id: 2, name: 'Bananas', default_unit: 'lb',   default_store_id: null, default_store: null },
]

const ON_HAND = [
  { item_id: 1, quantity: '3', unit: 'each' },
  { item_id: 2, quantity: '0', unit: 'lb' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.mocked(api.fetchOnHand).mockResolvedValue(ON_HAND)
  vi.mocked(api.createGroceryItem).mockResolvedValue({ id: 3, name: 'Carrots', default_unit: 'each' })
  vi.mocked(api.updateGroceryItem).mockResolvedValue(null)
  vi.mocked(api.upsertOnHand).mockResolvedValue(null)
  vi.mocked(api.deleteGroceryItem).mockResolvedValue(null)
})

describe('OnHandView — loading', () => {
  it('shows loading indicator while fetching', () => {
    vi.mocked(api.fetchOnHand).mockImplementation(() => new Promise(() => {}))
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

describe('OnHandView — rendering', () => {
  it('renders all catalog item names after loading', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    expect(screen.getByText('Bananas')).toBeInTheDocument()
  })

  it('shows default store for items that have one', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('ALDI')).toBeInTheDocument())
  })

  it('shows — for items without a default store', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument())
  })

  it('shows on-hand quantity for each item', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows empty catalog message when no items', async () => {
    render(<OnHandView catalogItems={[]} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/No catalog items yet/)).toBeInTheDocument())
  })
})

describe('OnHandView — search', () => {
  it('filters items by search text', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search items…'), { target: { value: 'app' } })
    expect(screen.getByText('Apples')).toBeInTheDocument()
    expect(screen.queryByText('Bananas')).not.toBeInTheDocument()
  })

  it('is case-insensitive', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search items…'), { target: { value: 'APPLE' } })
    expect(screen.getByText('Apples')).toBeInTheDocument()
  })

  it('shows no-results message when search has no matches', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search items…'), { target: { value: 'xyz' } })
    expect(screen.getByText(/No items match your search/)).toBeInTheDocument()
  })
})

describe('OnHandView — create item panel', () => {
  it('opens add panel on FAB click', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Add catalog item'))
    expect(screen.getByText('New Catalog Item')).toBeInTheDocument()
  })

  it('disables Save Item when name is empty', async () => {
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Add catalog item'))
    expect(screen.getByText('Save Item')).toBeDisabled()
  })

  it('calls createGroceryItem with correct payload and triggers catalog refresh', async () => {
    const onCatalogChange = vi.fn()
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={onCatalogChange} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Add catalog item'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Bone Broth'), { target: { value: 'Carrots' } })
    fireEvent.click(screen.getByText('Save Item'))
    await waitFor(() =>
      expect(api.createGroceryItem).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Carrots', default_unit: 'each' })
      )
    )
    await waitFor(() => expect(onCatalogChange).toHaveBeenCalled())
  })
})

describe('OnHandView — delete item', () => {
  it('calls deleteGroceryItem after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    const onCatalogChange = vi.fn()
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={onCatalogChange} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    fireEvent.click(screen.getAllByTitle('Remove from catalog')[0])
    await waitFor(() => expect(api.deleteGroceryItem).toHaveBeenCalledWith(1))
    await waitFor(() => expect(onCatalogChange).toHaveBeenCalled())
  })

  it('does not call deleteGroceryItem when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(<OnHandView catalogItems={CATALOG_ITEMS} stores={STORES} onCatalogChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Apples')).toBeInTheDocument())
    fireEvent.click(screen.getAllByTitle('Remove from catalog')[0])
    expect(api.deleteGroceryItem).not.toHaveBeenCalled()
  })
})
