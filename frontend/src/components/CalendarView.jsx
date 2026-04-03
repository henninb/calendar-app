import React, { useState, useCallback, useEffect, useMemo } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import { fetchOccurrences, fetchCategories, updateOccurrence } from '../api'

function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  })
}

export default function CalendarView() {
  const [occs, setOccs]           = useState([])
  const [cats, setCats]           = useState([])
  const [selected, setSelected]   = useState(null)
  const [saving, setSaving]       = useState(false)
  const [activeFilter, setFilter] = useState(null)

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

  const handleDatesSet = useCallback(async ({ startStr, endStr }) => {
    const start = startStr.slice(0, 10)
    const end   = endStr.slice(0, 10)
    const data  = await fetchOccurrences({ start_date: start, end_date: end })
    setOccs(data)
  }, [])

  const handleEventClick = ({ event }) => setSelected(event.extendedProps.occ)

  useEffect(() => {
    if (!selected) return
    const onKey = (e) => { if (e.key === 'Escape') setSelected(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  const markStatus = async (status) => {
    if (!selected) return
    setSaving(true)
    const updated = await updateOccurrence(selected.id, { status })
    setSelected(updated)
    setSaving(false)
    setOccs(prev => prev.map(o => o.id === updated.id ? updated : o))
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

      {/* Category filter legend */}
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

      {/* Detail side panel */}
      {selected && (
        <div className="detail-overlay" onClick={() => setSelected(null)}>
        <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
          <button className="close" onClick={() => setSelected(null)} title="Close this detail panel">✕</button>
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
                style={{ background: cats.find(c => c.name === selected.event?.category?.name)?.color ?? '#9ca3af' }}
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
          </div>
        </div>
        </div>
      )}
    </div>
  )
}
