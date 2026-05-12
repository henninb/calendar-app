import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import ConfigPage, { CONFIG_DEFAULTS, loadConfig } from '../ConfigPage'

vi.mock('@/lib/api', () => ({
  gcalAuthStatus: vi.fn(),
}))
import * as api from '@/lib/api'

const lsStore = {}
const localStorageMock = {
  getItem:    vi.fn((k) => lsStore[k] ?? null),
  setItem:    vi.fn((k, v) => { lsStore[k] = String(v) }),
  removeItem: vi.fn((k) => { delete lsStore[k] }),
  clear:      vi.fn(() => { Object.keys(lsStore).forEach(k => delete lsStore[k]) }),
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  api.gcalAuthStatus.mockResolvedValue({ authenticated: true })
})

function renderPage() {
  return render(<ConfigPage />)
}

// ── loadConfig ────────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  beforeEach(() => localStorageMock.clear())

  it('returns defaults when localStorage is empty', () => {
    expect(loadConfig()).toEqual(CONFIG_DEFAULTS)
  })

  it('merges stored values over defaults', () => {
    lsStore['calendarConfig'] = JSON.stringify({ gcalSyncDays: 180 })
    expect(loadConfig().gcalSyncDays).toBe(180)
  })

  it('returns defaults when localStorage value is invalid JSON', () => {
    lsStore['calendarConfig'] = 'not-json'
    expect(loadConfig()).toEqual(CONFIG_DEFAULTS)
  })
})

// ── rendering ─────────────────────────────────────────────────────────────────

describe('ConfigPage — rendering', () => {
  it('renders the Configuration heading', () => {
    renderPage()
    expect(screen.getByText('Configuration')).toBeInTheDocument()
  })

  it('shows "Connected" when gcalAuth resolves to true', async () => {
    api.gcalAuthStatus.mockResolvedValue({ authenticated: true })
    renderPage()
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument())
  })

  it('shows "Not connected" when gcalAuth resolves to false', async () => {
    api.gcalAuthStatus.mockResolvedValue({ authenticated: false })
    renderPage()
    await waitFor(() => expect(screen.getByText('Not connected')).toBeInTheDocument())
  })

  it('shows "Checking…" while gcalAuth is pending', () => {
    api.gcalAuthStatus.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Checking…')).toBeInTheDocument()
  })

  it('shows "Reconnect Google" when already connected', async () => {
    api.gcalAuthStatus.mockResolvedValue({ authenticated: true })
    renderPage()
    await waitFor(() => expect(screen.getByText('Reconnect Google')).toBeInTheDocument())
  })

  it('shows "Connect Google" when not connected', async () => {
    api.gcalAuthStatus.mockResolvedValue({ authenticated: false })
    renderPage()
    await waitFor(() => expect(screen.getByText('Connect Google')).toBeInTheDocument())
  })

  it('renders the days-ahead number input with the default value', () => {
    renderPage()
    expect(screen.getByDisplayValue('365')).toBeInTheDocument()
  })

  it('renders the force-sync checkbox unchecked by default', () => {
    renderPage()
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
  })

  it('renders the API key password input with stored value', async () => {
    lsStore['calendarConfig'] = JSON.stringify({ apiKey: 'secret' })
    renderPage()
    await waitFor(() => expect(screen.getByDisplayValue('secret')).toBeInTheDocument())
  })
})

// ── handleSave ────────────────────────────────────────────────────────────────

describe('ConfigPage — save', () => {
  beforeEach(() => localStorageMock.clear())

  it('persists to localStorage on save', () => {
    renderPage()
    fireEvent.click(screen.getByText('Save'))
    expect(localStorageMock.setItem).toHaveBeenCalledWith('calendarConfig', expect.any(String))
    const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1])
    expect(stored.gcalSyncDays).toBe(365)
  })

  it('shows "✓ Saved" feedback after clicking Save', () => {
    renderPage()
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('✓ Saved')).toBeInTheDocument()
  })

  it('reverts "✓ Saved" back to "Save" after 2 s', async () => {
    vi.useFakeTimers()
    renderPage()
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('✓ Saved')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(screen.getByText('Save')).toBeInTheDocument()
    vi.useRealTimers()
  })
})

// ── handleReset ───────────────────────────────────────────────────────────────

describe('ConfigPage — reset', () => {
  it('resets the days-ahead field to 365', async () => {
    lsStore['calendarConfig'] = JSON.stringify({ gcalSyncDays: 180 })
    renderPage()
    await waitFor(() => expect(screen.getByDisplayValue('180')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Reset to Defaults'))
    expect(screen.getByDisplayValue('365')).toBeInTheDocument()
  })

  it('unchecks force-sync after reset', async () => {
    lsStore['calendarConfig'] = JSON.stringify({ gcalSyncForce: true })
    renderPage()
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())
    fireEvent.click(screen.getByText('Reset to Defaults'))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})

// ── field changes ─────────────────────────────────────────────────────────────

describe('ConfigPage — field changes', () => {
  it('clamps days-ahead to 1 when given 0', () => {
    renderPage()
    const input = screen.getByDisplayValue('365')
    fireEvent.change(input, { target: { value: '0' } })
    expect(input.value).toBe('1')
  })

  it('clamps days-ahead to 730 when given 999', () => {
    renderPage()
    const input = screen.getByDisplayValue('365')
    fireEvent.change(input, { target: { value: '999' } })
    expect(input.value).toBe('730')
  })

  it('checking force-sync saves true to localStorage', () => {
    renderPage()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Save'))
    const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1])
    expect(stored.gcalSyncForce).toBe(true)
  })

  it('updating the API key saves the value to localStorage', () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('(none)'), { target: { value: 'my-key' } })
    fireEvent.click(screen.getByText('Save'))
    const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1])
    expect(stored.apiKey).toBe('my-key')
  })
})
