import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ConfigPage, { CONFIG_DEFAULTS, loadConfig } from '../ConfigPage'

// jsdom's localStorage can lose methods after certain operations; use a plain mock.
const lsStore = {}
const localStorageMock = {
  getItem:    vi.fn((k) => lsStore[k] ?? null),
  setItem:    vi.fn((k, v) => { lsStore[k] = String(v) }),
  removeItem: vi.fn((k) => { delete lsStore[k] }),
  clear:      vi.fn(() => { Object.keys(lsStore).forEach(k => delete lsStore[k]) }),
}
vi.stubGlobal('localStorage', localStorageMock)

const BASE_CONFIG = { gcalSyncDays: 365, gcalSyncForce: false, apiKey: '' }

function renderPage(props = {}) {
  const onSave = vi.fn()
  const { rerender, unmount } = render(
    <ConfigPage config={BASE_CONFIG} onSave={onSave} gcalAuth={true} {...props} />
  )
  return { onSave, rerender, unmount }
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

  it('shows "Connected" when gcalAuth is true', () => {
    renderPage({ gcalAuth: true })
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('shows "Not connected" when gcalAuth is false', () => {
    renderPage({ gcalAuth: false })
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('shows "Checking…" when gcalAuth is null', () => {
    renderPage({ gcalAuth: null })
    expect(screen.getByText('Checking…')).toBeInTheDocument()
  })

  it('shows "Reconnect Google" when already connected', () => {
    renderPage({ gcalAuth: true })
    expect(screen.getByText('Reconnect Google')).toBeInTheDocument()
  })

  it('shows "Connect Google" when not connected', () => {
    renderPage({ gcalAuth: false })
    expect(screen.getByText('Connect Google')).toBeInTheDocument()
  })

  it('renders the days-ahead number input with the config value', () => {
    renderPage()
    const input = screen.getByDisplayValue('365')
    expect(input).toBeInTheDocument()
  })

  it('renders the force-sync checkbox unchecked by default', () => {
    renderPage()
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
  })

  it('renders the API key password input', () => {
    renderPage({ config: { ...BASE_CONFIG, apiKey: 'secret' } })
    expect(screen.getByDisplayValue('secret')).toBeInTheDocument()
  })
})

// ── handleSave ────────────────────────────────────────────────────────────────

describe('ConfigPage — save', () => {
  beforeEach(() => localStorageMock.clear())

  it('calls onSave with the current form values', () => {
    const { onSave } = renderPage()
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith(BASE_CONFIG)
  })

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
  it('resets the days-ahead field to 365', () => {
    renderPage({ config: { ...BASE_CONFIG, gcalSyncDays: 180 } })
    fireEvent.click(screen.getByText('Reset to Defaults'))
    expect(screen.getByDisplayValue('365')).toBeInTheDocument()
  })

  it('unchecks force-sync after reset', () => {
    renderPage({ config: { ...BASE_CONFIG, gcalSyncForce: true } })
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

  it('checking force-sync passes true to onSave', () => {
    const { onSave } = renderPage()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ gcalSyncForce: true }))
  })

  it('updating the API key passes the value to onSave', () => {
    const { onSave } = renderPage()
    fireEvent.change(screen.getByPlaceholderText('(none)'), { target: { value: 'my-key' } })
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'my-key' }))
  })
})
