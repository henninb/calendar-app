import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GroceryListDetail from '../GroceryListDetail'

vi.mock('@/lib/api', () => ({
  fetchGroceryList:      vi.fn(),
  updateGroceryList:     vi.fn(),
  addGroceryListItem:    vi.fn(),
  updateGroceryListItem: vi.fn(),
  removeGroceryListItem: vi.fn(),
}))

import * as api from '@/lib/api'

const LIST = {
  id: 1,
  name: 'Weekly Run',
  status: 'active',
  store: { name: 'ALDI' },
  shopping_date: '2026-05-10',
  items: [
    { id: 10, item_id: 101, status: 'needed',    quantity: '2', unit: 'each', price: '3.99', item: { name: 'Apples' } },
    { id: 11, item_id: 102, status: 'purchased',  quantity: '1', unit: 'lb',   price: null,   item: { name: 'Bananas' } },
  ],
}

const CATALOG = [
  { id: 101, name: 'Apples',  default_unit: 'each' },
  { id: 102, name: 'Bananas', default_unit: 'lb' },
  { id: 103, name: 'Carrots', default_unit: 'each' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  api.fetchGroceryList.mockResolvedValue(LIST)
  api.updateGroceryList.mockResolvedValue({ ...LIST, status: 'completed', shopping_date: '2026-05-09' })
  api.updateGroceryListItem.mockResolvedValue(null)
  api.removeGroceryListItem.mockResolvedValue(null)
  api.addGroceryListItem.mockResolvedValue(null)
})

describe('GroceryListDetail — rendering', () => {
  it('shows list name', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText('Weekly Run')).toBeInTheDocument()
  })

  it('shows store name', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText(/ALDI/)).toBeInTheDocument()
  })

  it('shows shopping date', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText(/2026-05-10/)).toBeInTheDocument()
  })

  it('shows purchased/total count', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText(/1\/2 items purchased/)).toBeInTheDocument()
  })

  it('shows total cost for items with prices', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText(/\$7\.98/)).toBeInTheDocument()
  })

  it('shows all item names', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText('Apples')).toBeInTheDocument()
    expect(screen.getByText('Bananas')).toBeInTheDocument()
  })

  it('shows empty message when list has no items', () => {
    const emptyList = { ...LIST, items: [] }
    render(<GroceryListDetail list={emptyList} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText(/No items yet/)).toBeInTheDocument()
  })
})

describe('GroceryListDetail — navigation', () => {
  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn()
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={onBack} />)
    fireEvent.click(screen.getByText(/← Back to Lists/))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('GroceryListDetail — toggle purchased', () => {
  it('calls updateGroceryListItem to mark needed item as purchased', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const [applesCheckbox] = screen.getAllByRole('checkbox')
    fireEvent.click(applesCheckbox)
    await waitFor(() =>
      expect(api.updateGroceryListItem).toHaveBeenCalledWith(1, 101, { status: 'purchased' })
    )
  })

  it('calls updateGroceryListItem to unmark a purchased item', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    await waitFor(() =>
      expect(api.updateGroceryListItem).toHaveBeenCalledWith(1, 102, { status: 'needed' })
    )
  })
})

describe('GroceryListDetail — remove item', () => {
  it('calls removeGroceryListItem and removes item optimistically', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Remove from list')[0])
    await waitFor(() => expect(api.removeGroceryListItem).toHaveBeenCalledWith(1, 101))
    expect(screen.queryByText('Apples')).not.toBeInTheDocument()
  })
})

describe('GroceryListDetail — advance status', () => {
  it('shows "Mark Completed" button for an active list', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText('Mark Completed')).toBeInTheDocument()
  })

  it('shows "Start Shopping" button for a draft list', () => {
    const draftList = { ...LIST, status: 'draft' }
    render(<GroceryListDetail list={draftList} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText('Start Shopping')).toBeInTheDocument()
  })

  it('does not show an advance button for a completed list', () => {
    const completedList = { ...LIST, status: 'completed' }
    render(<GroceryListDetail list={completedList} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.queryByText('Mark Completed')).not.toBeInTheDocument()
    expect(screen.queryByText('Start Shopping')).not.toBeInTheDocument()
  })

  it('calls updateGroceryList with next status when advance button is clicked', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByText('Mark Completed'))
    await waitFor(() =>
      expect(api.updateGroceryList).toHaveBeenCalledWith(
        1, expect.objectContaining({ status: 'completed' })
      )
    )
  })
})

describe('GroceryListDetail — add item panel', () => {
  it('opens add item panel when FAB is clicked', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    expect(screen.getByRole('heading', { name: 'Add Item' })).toBeInTheDocument()
  })

  it('does not show FAB or add panel for a completed list', () => {
    const completedList = { ...LIST, status: 'completed' }
    render(<GroceryListDetail list={completedList} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.queryByTitle('Add item')).not.toBeInTheDocument()
  })

  it('shows message when catalog is empty', () => {
    render(<GroceryListDetail list={LIST} catalogItems={[]} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    expect(screen.getByText(/No catalog items yet/)).toBeInTheDocument()
  })

  it('calls addGroceryListItem when a catalog item is selected and Add Item is clicked', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    fireEvent.change(screen.getByPlaceholderText('Search catalog…'), { target: { value: 'Carrots' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }))
    await waitFor(() =>
      expect(api.addGroceryListItem).toHaveBeenCalledWith(
        1, { item_id: 103, quantity: '1', unit: 'each', price: null }
      )
    )
  })
})
