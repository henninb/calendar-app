import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
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
  vi.mocked(api.fetchGroceryList).mockResolvedValue(LIST)
  vi.mocked(api.updateGroceryList).mockResolvedValue({ ...LIST, status: 'completed', shopping_date: '2026-05-09' })
  vi.mocked(api.updateGroceryListItem).mockResolvedValue(null)
  vi.mocked(api.removeGroceryListItem).mockResolvedValue(null)
  vi.mocked(api.addGroceryListItem).mockResolvedValue(null)
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

  it('shows error when addGroceryListItem fails', async () => {
    vi.mocked(api.addGroceryListItem).mockRejectedValue(new Error('Add failed'))
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    fireEvent.change(screen.getByPlaceholderText('Search catalog…'), { target: { value: 'Carrots' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }))
    await waitFor(() => expect(screen.getByText('Add failed')).toBeInTheDocument())
  })

  it('closes panel on backdrop click', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    expect(screen.getByRole('heading', { name: 'Add Item' })).toBeInTheDocument()
    fireEvent.click(document.querySelector('.fixed.inset-0')!)
    const panel = document.querySelector('.translate-x-full')
    expect(panel).toBeInTheDocument()
  })
})

describe('GroceryListDetail — error handling', () => {
  it('shows error banner when togglePurchased API call fails', async () => {
    vi.mocked(api.updateGroceryListItem).mockRejectedValue(new Error('Toggle error'))
    vi.mocked(api.fetchGroceryList).mockResolvedValue(LIST)
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const [applesCheckbox] = screen.getAllByRole('checkbox')
    fireEvent.click(applesCheckbox)
    await waitFor(() => expect(screen.getByText('Toggle error')).toBeInTheDocument())
  })

  it('shows error banner when removeItem API call fails', async () => {
    vi.mocked(api.removeGroceryListItem).mockRejectedValue(new Error('Remove error'))
    vi.mocked(api.fetchGroceryList).mockResolvedValue(LIST)
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Remove from list')[0])
    await waitFor(() => expect(screen.getByText('Remove error')).toBeInTheDocument())
  })

  it('dismisses error banner when ✕ is clicked', async () => {
    vi.mocked(api.updateGroceryListItem).mockRejectedValue(new Error('Toggle error'))
    vi.mocked(api.fetchGroceryList).mockResolvedValue(LIST)
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const [applesCheckbox] = screen.getAllByRole('checkbox')
    fireEvent.click(applesCheckbox)
    await waitFor(() => expect(screen.getByText('Toggle error')).toBeInTheDocument())
    const errorBanner = screen.getByText('Toggle error').closest('div')!
    fireEvent.click(within(errorBanner).getByText('✕'))
    expect(screen.queryByText('Toggle error')).not.toBeInTheDocument()
  })

  it('shows error when handleAdvance fails', async () => {
    vi.mocked(api.updateGroceryList).mockRejectedValue(new Error('Advance error'))
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByText('Mark Completed'))
    await waitFor(() => expect(screen.getByText('Advance error')).toBeInTheDocument())
  })
})

describe('GroceryListDetail — onListChanged callback', () => {
  it('calls onListChanged after advancing status', async () => {
    const onListChanged = vi.fn()
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} onListChanged={onListChanged} />)
    fireEvent.click(screen.getByText('Mark Completed'))
    await waitFor(() => expect(api.updateGroceryList).toHaveBeenCalled())
    await waitFor(() => expect(onListChanged).toHaveBeenCalled())
  })
})

describe('GroceryListDetail — ItemRow editing', () => {
  it('opens inline edit form when quantity cell is clicked', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const qtyCells = screen.getAllByTitle('Click to edit')
    fireEvent.click(qtyCells[0])
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('calls updateGroceryListItem when Save is clicked in edit row', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const qtyCells = screen.getAllByTitle('Click to edit')
    fireEvent.click(qtyCells[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateGroceryListItem).toHaveBeenCalledWith(
        1, 101, expect.objectContaining({ quantity: '2', unit: 'each' })
      )
    )
  })

  it('hides edit form when Cancel is clicked in edit row', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const qtyCells = screen.getAllByTitle('Click to edit')
    fireEvent.click(qtyCells[0])
    // Save button is unique to edit row — find its sibling Cancel within the same td
    const saveBtn = screen.getByRole('button', { name: 'Save' })
    const cancelBtn = saveBtn.parentElement!.querySelector('button:last-child') as HTMLElement
    fireEvent.click(cancelBtn)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('saves edit via Enter key in quantity input', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const qtyCells = screen.getAllByTitle('Click to edit')
    fireEvent.click(qtyCells[0])
    const qtyInput = screen.getAllByRole('spinbutton')[0]
    fireEvent.keyDown(qtyInput, { key: 'Enter' })
    await waitFor(() => expect(api.updateGroceryListItem).toHaveBeenCalled())
  })

  it('cancels edit via Escape key in quantity input', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const qtyCells = screen.getAllByTitle('Click to edit')
    fireEvent.click(qtyCells[0])
    const qtyInput = screen.getAllByRole('spinbutton')[0]
    fireEvent.keyDown(qtyInput, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})

describe('GroceryListDetail — purchased/needed separator', () => {
  it('renders both needed and purchased items', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    expect(screen.getByText('Apples')).toBeInTheDocument()
    expect(screen.getByText('Bananas')).toBeInTheDocument()
  })
})

describe('GroceryListDetail — print button', () => {
  it('calls window.print when Print button is clicked', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByText(/Print/))
    expect(printSpy).toHaveBeenCalledTimes(1)
    printSpy.mockRestore()
  })
})

describe('GroceryListDetail — reload error', () => {
  it('shows reload error when fetchGroceryList fails after togglePurchased failure', async () => {
    vi.mocked(api.updateGroceryListItem).mockRejectedValue(new Error('Toggle error'))
    vi.mocked(api.fetchGroceryList).mockRejectedValue(new Error('Reload failed'))
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    const [applesCheckbox] = screen.getAllByRole('checkbox')
    fireEvent.click(applesCheckbox)
    await waitFor(() => expect(screen.getByText('Reload failed')).toBeInTheDocument())
  })
})

describe('GroceryListDetail — ItemCombobox interactions', () => {
  it('clears item_id when combobox input is emptied', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    const combobox = screen.getByPlaceholderText('Search catalog…')
    fireEvent.change(combobox, { target: { value: 'Apples' } })
    fireEvent.change(combobox, { target: { value: '' } })
    // Add Item button should remain disabled (no item_id selected)
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeDisabled()
  })

  it('resets combobox text to selected item name on blur', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    const combobox = screen.getByPlaceholderText('Search catalog…')
    // Select Apples so item_id is set, then type something different
    fireEvent.change(combobox, { target: { value: 'Apples' } })
    fireEvent.change(combobox, { target: { value: 'xyz' } })
    // Blur → resets to the current value's name ('Apples')
    fireEvent.blur(combobox)
    expect((combobox as HTMLInputElement).value).toBe('Apples')
  })
})

describe('GroceryListDetail — add item panel input interactions', () => {
  it('updates quantity field when changed', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    fireEvent.change(screen.getByPlaceholderText('Search catalog…'), { target: { value: 'Carrots' } })
    const qtyInput = screen.getByPlaceholderText('1')
    fireEvent.change(qtyInput, { target: { value: '3' } })
    expect((qtyInput as HTMLInputElement).value).toBe('3')
  })

  it('submits via Enter key in the price input', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    fireEvent.change(screen.getByPlaceholderText('Search catalog…'), { target: { value: 'Carrots' } })
    const priceInput = screen.getByPlaceholderText('Optional')
    fireEvent.change(priceInput, { target: { value: '1.99' } })
    fireEvent.keyDown(priceInput, { key: 'Enter' })
    await waitFor(() =>
      expect(api.addGroceryListItem).toHaveBeenCalledWith(
        1, expect.objectContaining({ item_id: 103, price: '1.99' })
      )
    )
  })
})

describe('GroceryListDetail — add panel Escape key', () => {
  it('closes the add panel when Escape is pressed', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add item'))
    expect(screen.getByRole('heading', { name: 'Add Item' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.translate-x-full')).toBeInTheDocument()
  })
})

describe('GroceryListDetail — ItemRow edit mode interactions', () => {
  it('updates unit select while in edit mode', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Click to edit')[0])
    // Add panel also has a unit select but is off-screen; edit row's select comes first in DOM
    const unitSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(unitSelect, { target: { value: 'lb' } })
    expect((unitSelect as HTMLSelectElement).value).toBe('lb')
  })

  it('updates price input while in edit mode', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Click to edit')[0])
    // placeholder="—" is unique to the edit row price input
    const priceInput = screen.getByPlaceholderText('—')
    fireEvent.change(priceInput, { target: { value: '4.99' } })
    expect((priceInput as HTMLInputElement).value).toBe('4.99')
  })

  it('saves via Enter key in the price field during edit', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Click to edit')[0])
    const priceInput = screen.getByPlaceholderText('—')
    fireEvent.keyDown(priceInput, { key: 'Enter' })
    await waitFor(() => expect(api.updateGroceryListItem).toHaveBeenCalled())
  })

  it('cancels via Escape key in the price field during edit', () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Click to edit')[0])
    const priceInput = screen.getByPlaceholderText('—')
    fireEvent.keyDown(priceInput, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('clicking checkbox while in edit mode calls onToggle', async () => {
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Click to edit')[0])
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    await waitFor(() => expect(api.updateGroceryListItem).toHaveBeenCalledWith(1, 101, { status: 'purchased' }))
  })

  it('swallows error silently when updateGroceryListItem fails during inline save', async () => {
    vi.mocked(api.updateGroceryListItem).mockRejectedValue(new Error('Save failed'))
    render(<GroceryListDetail list={LIST} catalogItems={CATALOG} onBack={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Click to edit')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    // The component should not crash and the save button should reappear (editing remains)
    await waitFor(() => expect(api.updateGroceryListItem).toHaveBeenCalled())
  })
})
