import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

let mockPathname = '/calendar'

vi.mock('next/link', () => ({
  default: ({ href, children, className, title }: {
    href: string; children: React.ReactNode; className?: string; title?: string
  }) => <a href={href} className={className} title={title}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

import AppHeader from '../AppHeader'

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPathname = '/calendar'
  vi.stubGlobal('localStorage', localStorageMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppHeader — navigation', () => {
  it('renders all nav tabs', () => {
    render(<AppHeader />)
    expect(screen.getByTitle('Switch to 📅 Calendar view')).toBeInTheDocument()
    expect(screen.getByTitle('Switch to ✅ Tasks view')).toBeInTheDocument()
    expect(screen.getByTitle('Switch to 🛒 Grocery view')).toBeInTheDocument()
    expect(screen.getByTitle('Switch to ⚙️ Config view')).toBeInTheDocument()
  })

  it('renders the app title', () => {
    render(<AppHeader />)
    expect(screen.getByText(/Calendar App/)).toBeInTheDocument()
  })

  it('marks the active tab with "active" class', () => {
    mockPathname = '/calendar'
    render(<AppHeader />)
    const calendarLink = screen.getByTitle('Switch to 📅 Calendar view')
    expect(calendarLink).toHaveClass('active')
  })

  it('does not mark inactive tabs as active', () => {
    mockPathname = '/calendar'
    render(<AppHeader />)
    const tasksLink = screen.getByTitle('Switch to ✅ Tasks view')
    expect(tasksLink).not.toHaveClass('active')
  })
})

describe('AppHeader — dark mode toggle', () => {
  it('renders dark/light mode button', () => {
    render(<AppHeader />)
    expect(screen.getByTitle('Toggle dark/light mode')).toBeInTheDocument()
  })

  it('toggles button text when clicked', () => {
    render(<AppHeader />)
    const btn = screen.getByTitle('Toggle dark/light mode')
    const initialText = btn.textContent
    fireEvent.click(btn)
    expect(btn.textContent).not.toBe(initialText)
  })
})

describe('AppHeader — no page-specific action buttons', () => {
  it('does not render Generate button on calendar page', () => {
    render(<AppHeader />)
    expect(screen.queryByTitle('Generate occurrences for all active events')).not.toBeInTheDocument()
  })

  it('does not render Google Sync button on tasks page', () => {
    mockPathname = '/tasks'
    render(<AppHeader />)
    expect(screen.queryByText('✅ Google Sync')).not.toBeInTheDocument()
  })
})
