'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAY_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa']

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

interface MonthGridProps {
  year: number
  month: number
  selected: string | null
  todayStr: string
  onSelect: (date: string) => void
}

function MonthGrid({ year, month, selected, todayStr, onSelect }: MonthGridProps) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const cells: (number | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="min-w-[196px]">
      <div className="text-center font-semibold text-sm text-slate-700 dark:text-slate-200 mb-2">
        {MONTH_NAMES[month]} {year}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {DAY_NAMES.map(d => (
          <div key={d} className="h-7 flex items-center justify-center text-[11px] text-slate-400 dark:text-slate-500 font-medium">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} />
          const dateStr = toDateStr(year, month, day)
          const isSelected = dateStr === selected
          const isToday = dateStr === todayStr
          return (
            <button
              key={day}
              onClick={() => onSelect(dateStr)}
              className={`h-7 w-7 mx-auto text-xs rounded-full flex items-center justify-center transition-colors
                ${isSelected
                  ? 'bg-blue-500 text-white font-semibold'
                  : isToday
                    ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold ring-1 ring-blue-300 dark:ring-blue-500/40'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface TwoMonthPickerProps {
  value: string | null
  anchorEl: HTMLElement | null
  onSelect: (date: string) => void
  onClear: () => void
  onClose: () => void
}

export default function TwoMonthPicker({ value, anchorEl, onSelect, onClear, onClose }: TwoMonthPickerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const today = useMemo(() => new Date(), [])
  const todayStr = useMemo(() => toDateStr(today.getFullYear(), today.getMonth(), today.getDate()), [today])

  const [offset, setOffset] = useState(0)

  const base = today.getFullYear() * 12 + today.getMonth() + offset
  const m1 = { year: Math.floor(base / 12), month: ((base % 12) + 12) % 12 }
  const nextBase = base + 1
  const m2 = { year: Math.floor(nextBase / 12), month: ((nextBase % 12) + 12) % 12 }

  const pos = useMemo(() => {
    if (!anchorEl) return { top: 0, left: 0 }
    const rect = anchorEl.getBoundingClientRect()
    const left = Math.min(rect.left + window.scrollX, window.innerWidth - 470)
    return { top: rect.bottom + window.scrollY + 6, left: Math.max(left, 8) }
  }, [anchorEl])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        (!anchorEl || !anchorEl.contains(e.target as Node))
      ) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose, anchorEl])

  useEffect(() => {
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'absolute', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setOffset(o => o - 1)}
          aria-label="Previous month"
          className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          ‹
        </button>
        {offset !== 0 && (
          <button
            type="button"
            onClick={() => setOffset(0)}
            className="text-[11px] text-blue-500 hover:underline"
          >
            Today
          </button>
        )}
        <button
          type="button"
          onClick={() => setOffset(o => o + 1)}
          aria-label="Next month"
          className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          ›
        </button>
      </div>
      <div className="flex gap-6">
        <MonthGrid {...m1} selected={value} todayStr={todayStr} onSelect={onSelect} />
        <div className="w-px bg-slate-100 dark:bg-slate-700" />
        <MonthGrid {...m2} selected={value} todayStr={todayStr} onSelect={onSelect} />
      </div>
      {value && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-end">
          <button
            onClick={onClear}
            className="text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            Clear date
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}

