import React, { useState, useCallback } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import { fetchOccurrences, updateOccurrence } from '../api'

const CATEGORY_COLORS = {
  birthday:          '#ef4444',
  car_maintenance:   '#f97316',
  house_maintenance: '#eab308',
  holiday:           '#22c55e',
  finance:           '#3b82f6',
  medical:           '#ec4899',
  dental:            '#06b6d4',
  payment:           '#a855f7',
  property_tax:      '#f59e0b',
  tax:               '#1d4ed8',
  credit_card:       '#6366f1',
  software:          '#6b7280',
  other:             '#9ca3af',
}

function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  })
}

export default function CalendarView() {
  const [events, setEvents] = useState([])
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)

  const handleDatesSet = useCallback(async ({ startStr, endStr }) => {
    const start = startStr.slice(0, 10)
    const end   = endStr.slice(0, 10)
    const occs  = await fetchOccurrences({ start_date: start, end_date: end })
    setEvents(occs.map(occ => ({
      id: String(occ.id),
      title: occ.event.title,
      date: occ.occurrence_date,
      backgroundColor: CATEGORY_COLORS[occ.event.category.name] ?? '#9ca3af',
      borderColor:     CATEGORY_COLORS[occ.event.category.name] ?? '#9ca3af',
      textColor: '#fff',
      extendedProps: { occ },
    })))
  }, [])

  const handleEventClick = ({ event }) => setSelected(event.extendedProps.occ)

  const markStatus = async (status) => {
    if (!selected) return
    setSaving(true)
    const updated = await updateOccurrence(selected.id, { status })
    setSelected(updated)
    setSaving(false)
    // refresh the event color
    setEvents(prev => prev.map(e =>
      e.id === String(updated.id)
        ? { ...e, extendedProps: { occ: updated } }
        : e
    ))
  }

  return (
    <div>
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

      {/* Category legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '1rem' }}>
        {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
          <span key={cat} className="badge" style={{ background: color }}>
            {cat.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Detail side panel */}
      {selected && (
        <div className="detail-panel">
          <button className="close" onClick={() => setSelected(null)}>✕</button>
          <h2>{selected.event?.title}</h2>

          <div className="detail-row">
            <span>Date</span>
            <span>{fmt(selected.occurrence_date)}</span>
          </div>
          <div className="detail-row">
            <span>Category</span>
            <span>
              <span
                className="badge"
                style={{ background: CATEGORY_COLORS[selected.event?.category?.name] ?? '#9ca3af' }}
              >
                {selected.event?.category?.name?.replace(/_/g, ' ')}
              </span>
            </span>
          </div>
          <div className="detail-row">
            <span>Status</span>
            <span className={`status ${selected.status}`}>{selected.status}</span>
          </div>
          {selected.event?.description && (
            <div className="detail-row">
              <span>Notes</span>
              <span>{selected.event.description}</span>
            </div>
          )}
          {selected.event?.amount && (
            <div className="detail-row">
              <span>Amount</span>
              <span>${Number(selected.event.amount).toFixed(2)}</span>
            </div>
          )}
          {selected.event?.reminder_days?.length > 0 && (
            <div className="detail-row">
              <span>Reminders</span>
              <span>{selected.event.reminder_days.map(d => `${d}d before`).join(', ')}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-green"
              disabled={saving || selected.status === 'completed'}
              onClick={() => markStatus('completed')}
            >
              ✓ Done
            </button>
            <button
              className="btn btn-gray"
              disabled={saving || selected.status === 'skipped'}
              onClick={() => markStatus('skipped')}
            >
              Skip
            </button>
            {selected.status !== 'upcoming' && (
              <button
                className="btn btn-blue"
                disabled={saving}
                onClick={() => markStatus('upcoming')}
              >
                Reopen
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
