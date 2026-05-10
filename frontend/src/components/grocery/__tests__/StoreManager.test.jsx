import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StoreManager from '../StoreManager'

vi.mock('../../../api', () => ({
  createStore: vi.fn(),
  updateStore: vi.fn(),
  deleteStore: vi.fn(),
}))

import * as api from '../../../api'

const STORES = [
  { id: 1, name: 'ALDI', location: 'Coon Rapids, MN' },
  { id: 2, name: 'Costco', location: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  api.createStore.mockResolvedValue({ id: 3, name: 'Target', location: null })
  api.updateStore.mockResolvedValue({ id: 1, name: 'ALDI Updated', location: null })
  api.deleteStore.mockResolvedValue(null)
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
    // Cancel in the footer — multiple Cancels exist, pick the one in the open panel footer
    const cancelButtons = screen.getAllByText('Cancel')
    fireEvent.click(cancelButtons[cancelButtons.length - 1])
    // Panel slides off-screen (translate-x-full applied)
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
    api.deleteStore.mockRejectedValue(new Error('Server error'))
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Delete store')[0])
    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument())
  })

  it('dismisses error banner when close is clicked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    api.deleteStore.mockRejectedValue(new Error('Server error'))
    render(<StoreManager stores={STORES} onStoresChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Delete store')[0])
    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument())
    // First ✕ in DOM order is the error banner's close button
    fireEvent.click(screen.getAllByText('✕')[0])
    expect(screen.queryByText('Server error')).not.toBeInTheDocument()
  })
})
