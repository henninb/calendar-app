import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import StoreManager from '../StoreManager'

vi.mock('@/lib/api', () => ({
  createStore: vi.fn(),
  updateStore: vi.fn(),
  deleteStore: vi.fn(),
}))

import * as api from '@/lib/api'

const STORES = [
  { id: 1, name: 'ALDI', location: 'Coon Rapids, MN' },
  { id: 2, name: 'Costco', location: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.mocked(api.createStore).mockResolvedValue({ id: 3, name: 'Target', location: null })
  vi.mocked(api.updateStore).mockResolvedValue({ id: 1, name: 'ALDI Updated', location: null })
  vi.mocked(api.deleteStore).mockResolvedValue(null)
})

describe('StoreManager — empty state', () => {
  it('shows empty message when no stores', () => {
    render(<StoreManager stores={[]} onStoresChange={vi.fn()} />)
    expect(screen.getByText(/No stores yet/)).toBeInTheDocument()
  })
})

describe('StoreManager — with stores', () => {
  it('renders all store names', () => {
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    expect(screen.getByText('ALDI')).toBeInTheDocument()
    expect(screen.getByText('Costco')).toBeInTheDocument()
  })

  it('shows location for stores that have one', () => {
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    expect(screen.getByText('Coon Rapids, MN')).toBeInTheDocument()
  })

  it('shows — for stores without a location', () => {
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('StoreManager — create panel', () => {
  it('opens create panel when FAB is clicked', () => {
    render(<StoreManager stores={[]} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add store'))
    expect(screen.getByText('New Store')).toBeInTheDocument()
  })

  it('disables Save Store when name is empty', () => {
    render(<StoreManager stores={[]} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add store'))
    expect(screen.getByText('Save Store')).toBeDisabled()
  })

  it('calls createStore with correct payload including location', async () => {
    const onStoresChange = vi.fn()
    render(<StoreManager stores={[]} onStoresChange={onStoresChange} />)
    fireEvent.click(screen.getByTitle('Add store'))
    fireEvent.change(screen.getByPlaceholderText('e.g. ALDI'), { target: { value: 'Target' } })
    fireEvent.change(screen.getByPlaceholderText('Optional'), { target: { value: 'Maple Grove' } })
    fireEvent.click(screen.getByText('Save Store'))
    await waitFor(() => expect(api.createStore).toHaveBeenCalledWith({ name: 'Target', location: 'Maple Grove' }))
    await waitFor(() => expect(onStoresChange).toHaveBeenCalled())
  })

  it('passes null location when location field is empty', async () => {
    render(<StoreManager stores={[]} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add store'))
    fireEvent.change(screen.getByPlaceholderText('e.g. ALDI'), { target: { value: 'Whole Foods' } })
    fireEvent.click(screen.getByText('Save Store'))
    await waitFor(() => expect(api.createStore).toHaveBeenCalledWith({ name: 'Whole Foods', location: null }))
  })

  it('closes panel when Cancel is clicked', () => {
    render(<StoreManager stores={[]} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add store'))
    expect(screen.getByText('New Store')).toBeInTheDocument()
    const cancelButtons = screen.getAllByText('Cancel')
    fireEvent.click(cancelButtons[cancelButtons.length - 1])
    const panel = document.querySelector('.translate-x-full')
    expect(panel).toBeInTheDocument()
  })
})

describe('StoreManager — delete', () => {
  it('calls deleteStore after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    const onStoresChange = vi.fn()
    render(<StoreManager stores={STORES} onStoresChange={onStoresChange} />)
    fireEvent.click(screen.getAllByTitle('Delete store')[0])
    await waitFor(() => expect(api.deleteStore).toHaveBeenCalledWith(1))
    await waitFor(() => expect(onStoresChange).toHaveBeenCalled())
  })

  it('does not call deleteStore when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Delete store')[0])
    expect(api.deleteStore).not.toHaveBeenCalled()
  })
})

describe('StoreManager — error banner', () => {
  it('shows error when deleteStore fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(api.deleteStore).mockRejectedValue(new Error('Server error'))
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Delete store')[0])
    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument())
  })

  it('dismisses error banner when close is clicked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(api.deleteStore).mockRejectedValue(new Error('Server error'))
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Delete store')[0])
    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('✕')[0])
    expect(screen.queryByText('Server error')).not.toBeInTheDocument()
  })

  it('shows error when createStore fails', async () => {
    vi.mocked(api.createStore).mockRejectedValue(new Error('Create failed'))
    render(<StoreManager stores={[]} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add store'))
    fireEvent.change(screen.getByPlaceholderText('e.g. ALDI'), { target: { value: 'Kroger' } })
    fireEvent.click(screen.getByText('Save Store'))
    await waitFor(() => expect(screen.getByText('Create failed')).toBeInTheDocument())
  })
})

describe('StoreManager — inline edit', () => {
  it('opens inline edit form when Edit store is clicked', () => {
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Edit store')[0])
    expect(screen.getByDisplayValue('ALDI')).toBeInTheDocument()
  })

  it('calls updateStore when Save is clicked in edit row', async () => {
    const onStoresChange = vi.fn()
    render(<StoreManager stores={STORES} onStoresChange={onStoresChange} />)
    fireEvent.click(screen.getAllByTitle('Edit store')[0])
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(api.updateStore).toHaveBeenCalledWith(1, expect.any(Object)))
    await waitFor(() => expect(onStoresChange).toHaveBeenCalled())
  })

  it('hides edit form when Cancel is clicked', () => {
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Edit store')[0])
    expect(screen.getByDisplayValue('ALDI')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Cancel')[0])
    expect(screen.queryByDisplayValue('ALDI')).not.toBeInTheDocument()
  })

  it('saves edit via Enter key on name field', async () => {
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Edit store')[0])
    fireEvent.keyDown(screen.getByDisplayValue('ALDI'), { key: 'Enter' })
    await waitFor(() => expect(api.updateStore).toHaveBeenCalledWith(1, expect.any(Object)))
  })

  it('cancels edit via Escape key on name field', () => {
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Edit store')[0])
    fireEvent.keyDown(screen.getByDisplayValue('ALDI'), { key: 'Escape' })
    expect(screen.queryByDisplayValue('ALDI')).not.toBeInTheDocument()
  })

  it('shows error when updateStore fails', async () => {
    vi.mocked(api.updateStore).mockRejectedValue(new Error('Update failed'))
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Edit store')[0])
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByText('Update failed')).toBeInTheDocument())
  })
})

describe('StoreManager — AddStorePanel keyboard', () => {
  it('saves store when Enter is pressed in name field', async () => {
    render(<StoreManager stores={[]} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add store'))
    fireEvent.change(screen.getByPlaceholderText('e.g. ALDI'), { target: { value: 'Sprouts' } })
    fireEvent.keyDown(screen.getByPlaceholderText('e.g. ALDI'), { key: 'Enter' })
    await waitFor(() => expect(api.createStore).toHaveBeenCalledWith({ name: 'Sprouts', location: null }))
  })

  it('closes panel via Escape key', () => {
    render(<StoreManager stores={[]} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Add store'))
    expect(screen.getByText('New Store')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    const panel = document.querySelector('.translate-x-full')
    expect(panel).toBeInTheDocument()
  })
})
