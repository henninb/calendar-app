import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GroceryListPanel from '../GroceryListPanel'

const STORES = [
  { id: 1, name: 'ALDI', location: 'Coon Rapids, MN' },
  { id: 2, name: 'Costco', location: null },
]

function renderPanel(props = {}) {
  const defaults = {
    open: true, mode: 'create', list: null,
    stores: STORES, onClose: vi.fn(), onSave: vi.fn(),
  }
  return render(<GroceryListPanel {...defaults} {...props} />)
}

describe('GroceryListPanel — create mode', () => {
  it('renders the create heading', () => {
    renderPanel()
    expect(screen.getByText('New Shopping List')).toBeInTheDocument()
  })

  it('shows all stores in the dropdown', () => {
    renderPanel()
    expect(screen.getByText('ALDI — Coon Rapids, MN')).toBeInTheDocument()
    expect(screen.getByText('Costco')).toBeInTheDocument()
  })

  it('disables Save when name is empty', () => {
    renderPanel()
    expect(screen.getByText('Create List')).toBeDisabled()
  })

  it('calls onSave with correct payload', async () => {
    const onSave = vi.fn()
    renderPanel({ onSave })
    fireEvent.change(screen.getByPlaceholderText('e.g. Weekly ALDI Run'), { target: { value: 'ALDI Run' } })
    fireEvent.click(screen.getByText('Create List'))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ALDI Run', status: 'draft' })
    ))
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    renderPanel({ onClose })
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('GroceryListPanel — edit mode', () => {
  const existingList = {
    id: 5, name: 'Weekly Run', store_id: 1, status: 'active', shopping_date: '2026-04-18',
  }

  it('renders the edit heading', () => {
    renderPanel({ mode: 'edit', list: existingList })
    expect(screen.getByText('Edit List')).toBeInTheDocument()
  })

  it('pre-fills the name field', () => {
    renderPanel({ mode: 'edit', list: existingList })
    expect(screen.getByPlaceholderText('e.g. Weekly ALDI Run').value).toBe('Weekly Run')
  })

  it('shows Save Changes button', () => {
    renderPanel({ mode: 'edit', list: existingList })
    expect(screen.getByText('Save Changes')).toBeInTheDocument()
  })
})

describe('GroceryListPanel — closed', () => {
  it('translates off-screen when closed', () => {
    const { container } = renderPanel({ open: false })
    // Panel uses CSS translate-x-full to slide off-screen — it stays in the DOM
    const panel = container.querySelector('.translate-x-full')
    expect(panel).toBeInTheDocument()
  })
})
