import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import GroceryPage from '../GroceryPage'

vi.mock('@/lib/api', () => ({
  fetchStores: vi.fn(),
  fetchGroceryItems: vi.fn(),
}))
vi.mock('../GroceryLists', () => ({ default: () => <div data-testid="grocery-lists">GroceryLists</div> }))
vi.mock('../OnHandView', () => ({ default: () => <div data-testid="onhand-view">OnHandView</div> }))
vi.mock('../StoreManager', () => ({ default: () => <div data-testid="store-manager">StoreManager</div> }))

import * as api from '@/lib/api'

beforeEach(() => {
  vi.mocked(api.fetchStores).mockResolvedValue([])
  vi.mocked(api.fetchGroceryItems).mockResolvedValue([])
})

describe('GroceryPage — tab navigation', () => {
  it('shows Shopping Lists tab by default', () => {
    render(<GroceryPage />)
    expect(screen.getByTestId('grocery-lists')).toBeInTheDocument()
    expect(screen.queryByTestId('onhand-view')).not.toBeInTheDocument()
    expect(screen.queryByTestId('store-manager')).not.toBeInTheDocument()
  })

  it('switches to On Hand tab', () => {
    render(<GroceryPage />)
    fireEvent.click(screen.getByText('On Hand'))
    expect(screen.getByTestId('onhand-view')).toBeInTheDocument()
    expect(screen.queryByTestId('grocery-lists')).not.toBeInTheDocument()
  })

  it('switches to Stores tab', () => {
    render(<GroceryPage />)
    fireEvent.click(screen.getByText('Stores'))
    expect(screen.getByTestId('store-manager')).toBeInTheDocument()
    expect(screen.queryByTestId('grocery-lists')).not.toBeInTheDocument()
  })

  it('can switch back to Shopping Lists from another tab', () => {
    render(<GroceryPage />)
    fireEvent.click(screen.getByText('Stores'))
    fireEvent.click(screen.getByText('Shopping Lists'))
    expect(screen.getByTestId('grocery-lists')).toBeInTheDocument()
    expect(screen.queryByTestId('store-manager')).not.toBeInTheDocument()
  })
})
