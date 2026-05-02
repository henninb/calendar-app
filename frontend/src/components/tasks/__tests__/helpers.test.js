import { describe, it, expect } from 'vitest'
import {
  parseMinutes,
  withAlpha,
  isOverdue,
  fmt,
  localDate,
  undoDescription,
  reversePayload,
  getDaysBadge,
} from '../helpers'

// ── parseMinutes ──────────────────────────────────────────────────────────────

describe('parseMinutes', () => {
  it('returns a positive integer as-is', () => {
    expect(parseMinutes('30')).toBe(30)
    expect(parseMinutes('1')).toBe(1)
    expect(parseMinutes(60)).toBe(60)
  })

  it('truncates decimals to the integer part', () => {
    expect(parseMinutes('45.9')).toBe(45)
  })

  it('returns null for zero', () => {
    expect(parseMinutes('0')).toBeNull()
    expect(parseMinutes(0)).toBeNull()
  })

  it('returns null for negative numbers', () => {
    expect(parseMinutes('-5')).toBeNull()
  })

  it('returns null for non-numeric strings', () => {
    expect(parseMinutes('')).toBeNull()
    expect(parseMinutes('abc')).toBeNull()
    expect(parseMinutes(null)).toBeNull()
    expect(parseMinutes(undefined)).toBeNull()
  })
})

// ── withAlpha ─────────────────────────────────────────────────────────────────

describe('withAlpha', () => {
  it('appends 2-digit hex alpha to a 6-digit hex color', () => {
    expect(withAlpha('#ff0000', 1)).toBe('#ff0000ff')
    expect(withAlpha('#ff0000', 0)).toBe('#ff000000')
  })

  it('expands a 3-digit hex color and appends alpha', () => {
    // #abc → #aabbcc
    expect(withAlpha('#abc', 1)).toBe('#aabbccff')
    expect(withAlpha('#abc', 0)).toBe('#aabbcc00')
  })

  it('rounds alpha to the nearest byte', () => {
    // 0.5 * 255 = 127.5 → rounds to 128 = 0x80
    expect(withAlpha('#000000', 0.5)).toBe('#00000080')
  })

  it('passes through non-hex formats unchanged', () => {
    expect(withAlpha('rgba(0,0,0,0.5)', 0.5)).toBe('rgba(0,0,0,0.5)')
    expect(withAlpha('red', 1)).toBe('red')
  })
})

// ── isOverdue ─────────────────────────────────────────────────────────────────

describe('isOverdue', () => {
  const pastDate   = '2000-01-01'
  const futureDate = '2099-12-31'

  it('returns true for a past due_date on a todo task', () => {
    expect(isOverdue({ due_date: pastDate, status: 'todo' })).toBe(true)
  })

  it('returns true for a past due_date on an in_progress task', () => {
    expect(isOverdue({ due_date: pastDate, status: 'in_progress' })).toBe(true)
  })

  it('returns false for a future due_date', () => {
    expect(isOverdue({ due_date: futureDate, status: 'todo' })).toBe(false)
  })

  it('returns false when status is done', () => {
    expect(isOverdue({ due_date: pastDate, status: 'done' })).toBe(false)
  })

  it('returns false when status is cancelled', () => {
    expect(isOverdue({ due_date: pastDate, status: 'cancelled' })).toBe(false)
  })

  it('returns falsy when due_date is absent', () => {
    expect(isOverdue({ due_date: null, status: 'todo' })).toBeFalsy()
    expect(isOverdue({ status: 'todo' })).toBeFalsy()
  })

  it('accepts a custom now for deterministic testing', () => {
    const now = new Date('2024-06-01T00:00:00')
    expect(isOverdue({ due_date: '2024-05-31', status: 'todo' }, now)).toBe(true)
    expect(isOverdue({ due_date: '2024-06-01', status: 'todo' }, now)).toBe(false)
    expect(isOverdue({ due_date: '2024-06-02', status: 'todo' }, now)).toBe(false)
  })
})

// ── fmt ───────────────────────────────────────────────────────────────────────

describe('fmt', () => {
  it('formats a YYYY-MM-DD string as "Mon D, YYYY" in en-US', () => {
    expect(fmt('2024-01-15')).toBe('Jan 15, 2024')
    expect(fmt('2024-12-31')).toBe('Dec 31, 2024')
  })

  it('returns null for a falsy value', () => {
    expect(fmt(null)).toBeNull()
    expect(fmt('')).toBeNull()
    expect(fmt(undefined)).toBeNull()
  })
})

// ── localDate ─────────────────────────────────────────────────────────────────

describe('localDate', () => {
  it('returns today as a YYYY-MM-DD string with offset 0', () => {
    const result = localDate(0)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const d = new Date()
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(result).toBe(expected)
  })

  it('returns tomorrow with offset 1', () => {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const expected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    expect(localDate(1)).toBe(expected)
  })

  it('returns yesterday with offset -1', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const expected = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    expect(localDate(-1)).toBe(expected)
  })
})

// ── undoDescription ───────────────────────────────────────────────────────────

describe('undoDescription', () => {
  const T = 'My Task'

  it('describes marking done', () => {
    expect(undoDescription(T, { status: 'done' })).toBe('"My Task" marked as done')
  })

  it('describes starting (in_progress)', () => {
    expect(undoDescription(T, { status: 'in_progress' })).toBe('"My Task" started')
  })

  it('describes cancellation', () => {
    expect(undoDescription(T, { status: 'cancelled' })).toBe('"My Task" cancelled')
  })

  it('describes reopening (todo)', () => {
    expect(undoDescription(T, { status: 'todo' })).toBe('"My Task" reopened')
  })

  it('describes a title rename', () => {
    expect(undoDescription(T, { title: 'New Name' })).toBe('"My Task" renamed')
  })

  it('describes a category change', () => {
    expect(undoDescription(T, { category_id: 3 })).toBe('Category changed on "My Task"')
  })

  it('describes a due-date change', () => {
    expect(undoDescription(T, { due_date: '2024-06-01' })).toBe('Due date changed on "My Task"')
  })

  it('describes an assignee change', () => {
    expect(undoDescription(T, { assignee_id: 7 })).toBe('Assignee changed on "My Task"')
  })

  it('describes an estimated_minutes change', () => {
    expect(undoDescription(T, { estimated_minutes: 30 })).toBe('Duration changed on "My Task"')
  })

  it('falls back to a generic description', () => {
    expect(undoDescription(T, { priority: 'high' })).toBe('"My Task" updated')
  })
})

// ── reversePayload ────────────────────────────────────────────────────────────

describe('reversePayload', () => {
  it('maps each changed key back to the prior value', () => {
    const prior = { status: 'todo', title: 'Old Title', due_date: '2024-01-01' }
    const data  = { status: 'done', title: 'New Title' }
    expect(reversePayload(prior, data)).toEqual({ status: 'todo', title: 'Old Title' })
  })

  it('uses null when the prior value was absent (undefined)', () => {
    const prior = { status: 'todo' }
    const data  = { due_date: '2024-06-01' }
    expect(reversePayload(prior, data)).toEqual({ due_date: null })
  })

  it('uses null when the prior value was explicitly null', () => {
    const prior = { assignee_id: null }
    const data  = { assignee_id: 5 }
    expect(reversePayload(prior, data)).toEqual({ assignee_id: null })
  })

  it('handles a payload with a single key', () => {
    const prior = { status: 'in_progress' }
    const data  = { status: 'done' }
    expect(reversePayload(prior, data)).toEqual({ status: 'in_progress' })
  })

  it('returns an empty object for an empty data payload', () => {
    expect(reversePayload({ status: 'todo' }, {})).toEqual({})
  })
})

// ── getDaysBadge ──────────────────────────────────────────────────────────────

describe('getDaysBadge', () => {
  // Use a fixed "now" to make tests deterministic: midnight on 2024-01-15
  const NOW = new Date('2024-01-15T00:00:00')

  it('returns null when due_date is absent', () => {
    expect(getDaysBadge({ status: 'todo' }, NOW)).toBeNull()
    expect(getDaysBadge({ due_date: null, status: 'todo' }, NOW)).toBeNull()
  })

  it('returns null for done tasks', () => {
    expect(getDaysBadge({ due_date: '2024-01-10', status: 'done' }, NOW)).toBeNull()
  })

  it('returns null for cancelled tasks', () => {
    expect(getDaysBadge({ due_date: '2024-01-10', status: 'cancelled' }, NOW)).toBeNull()
  })

  it('returns overdue badge for a past due_date', () => {
    const badge = getDaysBadge({ due_date: '2024-01-10', status: 'todo' }, NOW)
    expect(badge).not.toBeNull()
    expect(badge.text).toBe('5d overdue')
    expect(badge.cls).toContain('text-red-500')
  })

  it('returns "today" badge when due_date is today', () => {
    const badge = getDaysBadge({ due_date: '2024-01-15', status: 'todo' }, NOW)
    expect(badge).not.toBeNull()
    expect(badge.text).toBe('today')
    expect(badge.cls).toContain('text-amber-500')
  })

  it('returns amber badge for due within 3 days', () => {
    const badge = getDaysBadge({ due_date: '2024-01-17', status: 'todo' }, NOW)
    expect(badge).not.toBeNull()
    expect(badge.text).toBe('2d')
    expect(badge.cls).toContain('text-amber-500')
    expect(badge.cls).not.toContain('font-semibold')
  })

  it('returns slate badge for due in more than 3 days', () => {
    const badge = getDaysBadge({ due_date: '2024-01-20', status: 'todo' }, NOW)
    expect(badge).not.toBeNull()
    expect(badge.text).toBe('5d')
    expect(badge.cls).toContain('text-slate-400')
  })

  it('returns amber badge exactly at the 3-day boundary', () => {
    const badge = getDaysBadge({ due_date: '2024-01-18', status: 'todo' }, NOW)
    expect(badge.text).toBe('3d')
    expect(badge.cls).toContain('text-amber-500')
  })
})
