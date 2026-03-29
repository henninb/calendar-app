import React, { useState, useEffect } from 'react'
import CalendarView from './components/CalendarView'
import OccurrenceList from './components/OccurrenceList'
import CreditCardTracker from './components/CreditCardTracker'
import { generateAll, gcalAuthStatus, syncToGcal, deleteAllGcalEvents } from './api'

const TABS = [
  { id: 'calendar',  label: '📅 Calendar' },
  { id: 'upcoming',  label: '📋 Upcoming' },
  { id: 'cards',     label: '💳 Credit Cards' },
]

export default function App() {
  const [tab, setTab]         = useState('calendar')
  const [syncing, setSyncing]   = useState(false)
  const [gcalSyncing, setGcalSyncing] = useState(false)
  const [gcalDeleting, setGcalDeleting] = useState(false)
  const [gcalAuth, setGcalAuth] = useState(null)   // null=unknown, true/false
  const [msg, setMsg]           = useState('')

  useEffect(() => {
    gcalAuthStatus()
      .then(s => setGcalAuth(s.authenticated))
      .catch(() => setGcalAuth(false))
  }, [])

  const showMsg = (text) => {
    setMsg(text)
    setTimeout(() => setMsg(''), 5000)
  }

  const handleGenerate = async () => {
    setSyncing(true)
    setMsg('')
    const res = await generateAll()
    showMsg(`Generated ${res.occurrences_created} new occurrences across ${res.events_processed} events.`)
    setSyncing(false)
  }

  const handleGcalDelete = async () => {
    if (!gcalAuth) return
    if (!window.confirm('Delete ALL events from Google Calendar? This cannot be undone.')) return
    setGcalDeleting(true)
    setMsg('')
    try {
      const res = await deleteAllGcalEvents()
      showMsg(res.message || 'Google Calendar wipe started — check server logs.')
    } catch (e) {
      showMsg(`Delete failed: ${e.message}`)
    }
    setGcalDeleting(false)
  }

  const handleGcalSync = async () => {
    if (!gcalAuth) {
      window.location.href = '/api/sync/auth'
      return
    }
    setGcalSyncing(true)
    setMsg('')
    try {
      const res = await syncToGcal(365, true)
      showMsg(res.message || `Google Calendar: synced ${res.synced} events${res.failed ? `, ${res.failed} failed` : ''}.`)
    } catch (e) {
      showMsg(`Sync failed: ${e.message}`)
    }
    setGcalSyncing(false)
  }

  return (
    <div className="app">
      <header>
        <h1>📅 Calendar App</h1>
        <nav>
          {TABS.map(t => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          {msg && <span style={{ fontSize: '.8rem', color: '#86efac' }}>{msg}</span>}
          <button
            className="btn btn-blue"
            style={{ fontSize: '.8rem' }}
            disabled={syncing}
            onClick={handleGenerate}
          >
            {syncing ? 'Generating…' : '⟳ Generate'}
          </button>
          <button
            className="btn btn-blue"
            style={{ fontSize: '.8rem', background: gcalAuth ? '#16a34a' : '#2563eb' }}
            disabled={gcalSyncing}
            onClick={handleGcalSync}
          >
            {gcalSyncing ? 'Syncing…' : gcalAuth ? '📅 Sync to Google' : '🔗 Connect Google'}
          </button>
          {gcalAuth && (
            <button
              className="btn btn-blue"
              style={{ fontSize: '.8rem', background: '#dc2626' }}
              disabled={gcalDeleting}
              onClick={handleGcalDelete}
            >
              {gcalDeleting ? 'Deleting…' : '🗑 Clear Google Cal'}
            </button>
          )}
        </div>
      </header>

      <main>
        {tab === 'calendar' && <CalendarView />}
        {tab === 'upcoming' && <OccurrenceList />}
        {tab === 'cards'    && <CreditCardTracker />}
      </main>
    </div>
  )
}
