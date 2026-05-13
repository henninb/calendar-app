'use client'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import { fetchOccurrences, fetchCategories, updateOccurrence, deleteOccurrence, createEvent } from '@/lib/api'
import type { EventClickArg } from '@fullcalendar/core'
import EventPanel from '@/components/EventPanel'
import CalendarActions from '@/components/CalendarActions'

interface CalCategory {
  id: number
  name: string
  color: string
  icon: string
}

interface CalOccurrence {
  id: number
  occurrence_date: string
  status: string
  event: {
    title: string
    description?: string | null
    amount?: number | string | null
    reminder_days?: number[]
    category: { name: string; color?: string }
  }
}

function fmt(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  })
}

export default function CalendarView() {
  const [occs, setOccs]           = useState<CalOccurrence[]>([])
  const [cats, setCats]           = useState<CalCategory[]>([])
  const [selected, setSelected]   = useState<CalOccurrence | null>(null)
  const [saving, setSaving]       = useState(false)
  const [activeFilter, setFilter] = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const dateRangeRef              = useRef<{ start: string; end: string } | null>(null)

  useEffect(() => { fetchCategories().then(setCats) }, [])

  const events = useMemo(() =>
    occs
      .filter(occ => !activeFilter || occ.event.category.name === activeFilter)
      .map(occ => {
        const color = cats.find(c => c.name === occ.event.category.name)?.color ?? '#9ca3af'
        return {
          id: String(occ.id),
          title: occ.event.title,
          date: occ.occurrence_date,
          backgroundColor: color,
          borderColor:     color,
          textColor: '#fff',
          extendedProps: { occ },
        }
      }), [occs, cats, activeFilter])

  const handleDatesSet = useCallback(async ({ startStr, endStr }: { startStr: string; endStr: string }) => {
    const start = startStr.slice(0, 10)
    const end   = endStr.slice(0, 10)
    dateRangeRef.current = { start, end }
    const data = await fetchOccurrences({ start_date: start, end_date: end })
    setOccs(data)
  }, [])

  const handleCreateEvent = useCallback(async (payload: unknown) => {
    await createEvent(payload)
    if (dateRangeRef.current) {
      const data = await fetchOccurrences({
        start_date: dateRangeRef.current.start,
        end_date:   dateRangeRef.current.end,
      })
      setOccs(data)
    }
    setPanelOpen(false)
  }, [])

  const handleEventClick = (arg: EventClickArg) =>
    setSelected((arg.event.extendedProps as { occ: CalOccurrence }).occ)

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  const markStatus = async (status: string) => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const updated: CalOccurrence = await updateOccurrence(selected.id, { status })
      setSelected(updated)
      setOccs(prev => prev.map(o => o.id === updated.id ? updated : o))
    } catch (e) {
      setError(`Failed to update status: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!window.confirm(`Delete "${selected.event?.title}" on ${fmt(selected.occurrence_date)}? This cannot be undone.`)) return
    setSaving(true)
    setError(null)
    try {
      await deleteOccurrence(selected.id)
      setOccs(prev => prev.filter(o => o.id !== selected.id))
      setSelected(null)
    } catch (e) {
      setError(`Failed to delete occurrence: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <CalendarActions />
      <div className="card">
        <FullCalendar
          plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' }}
          events={events}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          height="auto"
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '1rem', alignItems: 'center' }}>
        <button
          onClick={() => setFilter(null)}
          title="Show events from all categories"
          style={{
            padding: '.25rem .6rem',
            borderRadius: '9999px',
            border: '2px solid',
            borderColor: activeFilter === null ? '#fff' : 'transparent',
            background: '#374151',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '.8rem',
            fontWeight: activeFilter === null ? 700 : 400,
          }}
        >
          all
        </button>
        {cats.map(cat => (
          <button
            key={cat.name}
            onClick={() => setFilter(activeFilter === cat.name ? null : cat.name)}
            title={activeFilter === cat.name ? 'Clear filter' : `Filter to show only ${cat.name.replace(/_/g, ' ')} events`}
            style={{
              padding: '.25rem .6rem',
              borderRadius: '9999px',
              border: '2px solid',
              borderColor: activeFilter === cat.name ? '#fff' : 'transparent',
              background: cat.color,
              color: '#fff',
              cursor: 'pointer',
              fontSize: '.8rem',
              fontWeight: activeFilter === cat.name ? 700 : 400,
              opacity: activeFilter && activeFilter !== cat.name ? 0.45 : 1,
            }}
          >
            {cat.name.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <button
        onClick={() => setPanelOpen(true)}
        title="New event"
        className="fixed bottom-6 right-6 z-40
          w-14 h-14 rounded-full
          bg-white dark:bg-slate-800
          border border-slate-200 dark:border-slate-700
          text-slate-600 dark:text-slate-300
          shadow-md hover:shadow-lg
          hover:bg-slate-50 dark:hover:bg-slate-700
          hover:border-slate-300 dark:hover:border-slate-600
          transition-all duration-200 active:scale-95
          flex items-center justify-center
          text-2xl leading-none select-none"
      >
        +
      </button>

      <EventPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onCreateEvent={handleCreateEvent}
        categories={cats}
      />

      {/* Event detail backdrop */}
      <div
        data-testid="event-detail-backdrop"
        className={`fixed inset-0 bg-black/40 dark:bg-black/60 z-40 transition-opacity duration-300
          ${selected ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setSelected(null)}
      />

      {/* Event detail slide-in panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] max-w-full z-50
          bg-white dark:bg-slate-900
          border-l border-slate-200 dark:border-slate-700/60
          shadow-2xl flex flex-col
          transition-transform duration-300 ease-in-out
          ${selected ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 truncate pr-2">
            {selected?.event?.title}
          </h2>
          <button
            onClick={() => setSelected(null)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0"
          >✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          {selected && (
            <>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Date</p>
                <p className="text-sm text-slate-800 dark:text-slate-200">{fmt(selected.occurrence_date)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Category</p>
                <span
                  className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
                  style={{ background: cats.find(c => c.name === selected.event?.category?.name)?.color ?? '#9ca3af' }}
                >
                  {selected.event?.category?.name?.replace(/_/g, ' ')}
                </span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Status</p>
                <span className={`status ${selected.status}`}>{selected.status}</span>
              </div>
              {selected.event?.description && (
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-slate-800 dark:text-slate-200">{selected.event.description}</p>
                </div>
              )}
              {selected.event?.amount && (
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Amount</p>
                  <p className="text-sm text-slate-800 dark:text-slate-200">${Number(selected.event.amount).toFixed(2)}</p>
                </div>
              )}
              {(selected.event?.reminder_days?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Reminders</p>
                  <p className="text-sm text-slate-800 dark:text-slate-200">
                    {selected.event.reminder_days!.map(d => `${d}d before`).join(', ')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-700/60 flex-shrink-0 flex-wrap">
          {selected && (
            <>
              <button
                className="btn btn-green"
                disabled={saving || selected.status === 'completed'}
                onClick={() => markStatus('completed')}
                title="Mark this occurrence as completed"
              >
                ✓ Done
              </button>
              <button
                className="btn btn-gray"
                disabled={saving || selected.status === 'skipped'}
                onClick={() => markStatus('skipped')}
                title="Mark this occurrence as skipped"
              >
                Skip
              </button>
              {selected.status !== 'upcoming' && (
                <button
                  className="btn btn-blue"
                  disabled={saving}
                  onClick={() => markStatus('upcoming')}
                  title="Reopen this occurrence as upcoming"
                >
                  Reopen
                </button>
              )}
              <button
                className="btn btn-red"
                disabled={saving}
                onClick={handleDelete}
                title="Permanently delete this calendar entry"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
