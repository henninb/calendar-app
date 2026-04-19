import React, { useState, useEffect, useRef, useCallback } from 'react'
import CalendarView from './components/CalendarView'
import OccurrenceList from './components/OccurrenceList'
import CreditCardTracker from './components/CreditCardTracker'
import TaskList from './components/tasks/TaskList'
import GroceryPage from './components/grocery/GroceryPage'
import ConfigPage, { loadConfig } from './components/ConfigPage'
import { generateAll, gcalAuthStatus, syncToGcal, deleteAllGcalEvents, wipeAllGcalEvents, syncToGtasks } from './api'

const LOG_COLOR = { info: '#93c5fd', ok: '#86efac', warn: '#fde68a', error: '#fca5a5' }

const TABS = [
  { id: 'calendar',  label: '📅 Calendar' },
  { id: 'upcoming',  label: '📋 Upcoming' },
  { id: 'cards',     label: '💳 Credit Cards' },
  { id: 'tasks',     label: '✅ Tasks' },
  { id: 'grocery',   label: '🛒 Grocery' },
  { id: 'config',    label: '⚙️ Config' },
]

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

export default function App() {
  const [tab, setTab]                   = useState('tasks')
  const [config, setConfig]             = useState(loadConfig)
  const [syncing, setSyncing]               = useState(false)
  const [gcalSyncing, setGcalSyncing]       = useState(false)
  const [gcalDeleting, setGcalDeleting]     = useState(false)
  const [gcalWiping, setGcalWiping]         = useState(false)
  const [gtasksSyncing, setGtasksSyncing]   = useState(false)
  const [gcalAuth, setGcalAuth]         = useState(null)
  const [logs, setLogs]                 = useState([])
  const [darkMode, setDarkMode]         = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved !== null ? saved === 'dark' : true
  })
  const logEndRef                       = useRef(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const addLog = useCallback((level, text) => {
    const id = Date.now() + Math.random()
    setLogs(prev => [...prev, { id, level, text, time: timestamp() }])
    return id
  }, [])

  const updateLog = useCallback((id, text) => {
    setLogs(prev => prev.map(entry => entry.id === id ? { ...entry, text } : entry))
  }, [])

  useEffect(() => {
    gcalAuthStatus()
      .then(s => {
        setGcalAuth(s.authenticated)
        addLog('info', `Google auth status: ${s.authenticated ? `authenticated (${s.email || 'no email'})` : 'not authenticated'}`)
      })
      .catch(() => setGcalAuth(false))
  }, [addLog])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleGenerate = async () => {
    setSyncing(true)
    addLog('info', 'Generating occurrences…')
    try {
      const res = await generateAll()
      addLog('ok', `Generated ${res.occurrences_created} new occurrences across ${res.events_processed} events.`)
    } catch (e) {
      addLog('error', `Generate failed: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleGcalSync = async () => {
    if (!gcalAuth) {
      addLog('info', 'Redirecting to Google OAuth…')
      window.location.href = '/api/sync/auth'
      return
    }
    setGcalSyncing(true)
    addLog('info', `Starting Google Calendar sync (force=${config.gcalSyncForce}, ${config.gcalSyncDays} days)…`)
    const progressId = addLog('info', 'Waiting for server…')
    try {
      const res = await syncToGcal(config.gcalSyncDays, config.gcalSyncForce, (data) => {
        if (data.type === 'start') {
          updateLog(progressId, `[gcal sync] 0/${data.total} starting…`)
        } else if (data.type === 'progress') {
          updateLog(progressId, `[gcal sync] ${data.msg}`)
        }
      })
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      const level = res.failed > 0 ? 'warn' : 'ok'
      addLog(level, `Synced ${res.synced} events to Google Calendar.${res.failed ? ` ${res.failed} failed.` : ''}`)
      if (res.failed > 0) {
        const quotaErrors = res.errors?.filter(e => e.includes('quotaExceeded') || e.includes('Quota Exceeded')) ?? []
        if (quotaErrors.length > 0) {
          addLog('warn', `Google Calendar API quota exceeded — daily limit reached. Try again tomorrow or increase your quota in the Google Cloud Console.`)
        } else {
          addLog('warn', `${res.failed} event(s) failed to sync — you may need to reconnect Google.`)
          res.errors?.slice(0, 5).forEach(err => addLog('error', err))
        }
      }
    } catch (e) {
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      addLog('error', `Google Calendar sync failed: ${e.message}`)
    } finally {
      setGcalSyncing(false)
    }
  }

  const handleGcalDelete = async () => {
    if (!gcalAuth) return
    if (!window.confirm('Delete all app-synced events from Google Calendar?')) return
    setGcalDeleting(true)
    addLog('info', 'Deleting app-synced Google Calendar events…')
    try {
      const res = await deleteAllGcalEvents()
      addLog('ok', res.message || 'Delete started in background.')
    } catch (e) {
      addLog('error', `Delete failed: ${e.message}`)
    } finally {
      setGcalDeleting(false)
    }
  }

  const handleGtasksSync = async () => {
    if (!gcalAuth) {
      addLog('info', 'Redirecting to Google OAuth…')
      window.location.href = '/api/sync/auth'
      return
    }
    setGtasksSyncing(true)
    addLog('info', 'Syncing tasks to Google Tasks…')
    const progressId = addLog('info', 'Waiting for server…')
    try {
      const res = await syncToGtasks((data) => {
        if (data.type === 'start') {
          updateLog(progressId, `[gtasks sync] 0/${data.total} starting…`)
        } else if (data.type === 'progress') {
          updateLog(progressId, `[gtasks sync] ${data.msg}`)
        }
      })
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      const level = res.failed > 0 ? 'warn' : 'ok'
      addLog(level, `Synced ${res.synced} tasks to Google Tasks.${res.failed ? ` ${res.failed} failed.` : ''}`)
      if (res.failed > 0) {
        const quotaErrors = res.errors?.filter(e => e.includes('quotaExceeded') || e.includes('Quota Exceeded')) ?? []
        if (quotaErrors.length > 0) {
          addLog('warn', `Google Tasks API quota exceeded — daily limit reached. Try again tomorrow or increase your quota in the Google Cloud Console.`)
        } else {
          addLog('warn', `${res.failed} task(s) failed to sync — you may need to reconnect Google.`)
          res.errors?.slice(0, 5).forEach(err => addLog('error', err))
        }
      }
    } catch (e) {
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      addLog('error', `Google Tasks sync failed: ${e.message}`)
    } finally {
      setGtasksSyncing(false)
    }
  }

  const handleGcalWipe = async () => {
    if (!gcalAuth) return
    if (!window.confirm('Delete ALL events from your primary Google Calendar? This includes events not created by this app and cannot be undone.')) return
    setGcalWiping(true)
    addLog('warn', 'Wiping ALL events from primary Google Calendar…')
    try {
      const res = await wipeAllGcalEvents()
      addLog('ok', res.message || 'Full wipe started in background.')
    } catch (e) {
      addLog('error', `Wipe failed: ${e.message}`)
    } finally {
      setGcalWiping(false)
    }
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
              title={`Switch to ${t.label} view`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => setDarkMode(d => !d)}
            title="Toggle dark/light mode"
            style={{ marginLeft: '.5rem' }}
          >
            {darkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          {tab === 'calendar' && (
            <button
              className="btn btn-blue"
              style={{ fontSize: '.8rem' }}
              disabled={syncing}
              onClick={handleGenerate}
              title="Generate occurrences for all active events"
            >
              {syncing ? 'Generating…' : '⟳ Generate'}
            </button>
          )}
          {tab === 'calendar' && (
            <button
              className="btn btn-blue"
              style={{ fontSize: '.8rem', background: gcalAuth ? '#16a34a' : '#2563eb' }}
              disabled={gcalSyncing}
              onClick={handleGcalSync}
              title={gcalAuth ? `Push events to Google Calendar (force=${config.gcalSyncForce}, ${config.gcalSyncDays} days)` : 'Connect your Google account to enable calendar sync'}
            >
              {gcalSyncing ? 'Syncing…' : gcalAuth ? '📅 Sync to Google Calendar' : '🔗 Connect Google'}
            </button>
          )}
          {tab === 'calendar' && gcalAuth && (
            <button
              className="btn btn-blue"
              style={{ fontSize: '.8rem', background: '#dc2626' }}
              disabled={gcalDeleting}
              onClick={handleGcalDelete}
              title="Delete all events synced by this app from Google Calendar"
            >
              {gcalDeleting ? 'Deleting…' : '🗑 Clear Google Cal'}
            </button>
          )}
          {tab === 'calendar' && gcalAuth && (
            <button
              className="btn btn-blue"
              style={{ fontSize: '.8rem', background: '#7f1d1d' }}
              disabled={gcalWiping}
              onClick={handleGcalWipe}
              title="Delete ALL events from your primary Google Calendar — including events not created by this app. Cannot be undone."
            >
              {gcalWiping ? 'Wiping…' : '💣 Wipe Google Cal'}
            </button>
          )}
          {tab === 'tasks' && (
            <div id="task-toolbar-slot" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} />
          )}
          {tab === 'tasks' && (
            <button
              className="btn btn-blue"
              style={{ fontSize: '.8rem', background: gcalAuth ? '#7c3aed' : '#2563eb' }}
              disabled={gtasksSyncing}
              onClick={handleGtasksSync}
              title={gcalAuth ? 'Sync tasks to Google Tasks' : 'Connect your Google account to enable Google Tasks sync'}
            >
              {gtasksSyncing ? 'Syncing…' : '✅ Google Sync'}
            </button>
          )}
        </div>
      </header>

      {logs.length > 0 && (
        <div style={{ position: 'relative', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
          <button
            onClick={() => setLogs([])}
            title="Clear activity log"
            aria-label="Clear activity log"
            style={{
              position: 'absolute', top: '.35rem', right: '.5rem',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#64748b', fontSize: '1rem', lineHeight: 1,
              padding: '2px 5px', borderRadius: '4px',
            }}
          >
            ✕
          </button>
          <div style={{
            padding: '.5rem 2rem .5rem 1rem', maxHeight: '10rem', overflowY: 'auto',
            fontFamily: 'monospace', fontSize: '.78rem',
          }}>
            {logs.map(entry => (
              <div key={entry.id} style={{ color: LOG_COLOR[entry.level], lineHeight: '1.6' }}>
                <span style={{ opacity: 0.5, marginRight: '.75rem' }}>{entry.time}</span>
                {entry.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      <main>
        {tab === 'calendar' && <CalendarView />}
        {tab === 'upcoming' && <OccurrenceList />}
        {tab === 'cards'    && <CreditCardTracker />}
        {tab === 'tasks'    && <TaskList />}
        {tab === 'grocery'  && <GroceryPage />}
        {tab === 'config'   && <ConfigPage config={config} onSave={setConfig} gcalAuth={gcalAuth} />}
      </main>
    </div>
  )
}
