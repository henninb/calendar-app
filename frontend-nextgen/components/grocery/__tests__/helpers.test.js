import { describe, it, expect } from 'vitest'
import { fmtQty, fmtPrice, listSummary } from '../helpers'

describe('fmtQty', () => {
  it('formats integer each quantity with ×', () => {
    expect(fmtQty('4', 'each')).toBe('× 4')
  })

  it('formats decimal each quantity', () => {
    expect(fmtQty('2.5', 'each')).toBe('× 2.5')
  })

  it('formats lb quantity with unit', () => {
    expect(fmtQty('2.49', 'lb')).toBe('2.49 lb')
  })

  it('formats can quantity with unit', () => {
    expect(fmtQty('2', 'can')).toBe('2 can')
  })
})

describe('fmtPrice', () => {
  it('returns empty string for null', () => {
    expect(fmtPrice(null)).toBe('')
  })

  it('formats price with two decimal places', () => {
    expect(fmtPrice('3.49')).toBe('$3.49')
  })

  it('formats integer price', () => {
    expect(fmtPrice('6')).toBe('$6.00')
  })
})

describe('listSummary', () => {
  it('returns zeros for empty list', () => {
    expect(listSummary([])).toEqual({ total: 0, done: 0 })
  })

  it('counts total and purchased items', () => {
    const items = [
      { status: 'needed' },
      { status: 'needed' },
      { status: 'purchased' },
    ]
    expect(listSummary(items)).toEqual({ total: 3, done: 1 })
  })

  it('counts all purchased', () => {
    const items = [{ status: 'purchased' }, { status: 'purchased' }]
    expect(listSummary(items)).toEqual({ total: 2, done: 2 })
  })
})
