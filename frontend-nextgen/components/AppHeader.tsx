'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { loadConfig } from '@/components/ConfigPage'
import {
  gcalAuthStatus, generateAll, syncToGcal,
  deleteAllGcalEvents, wipeAllGcalEvents, syncToGtasks,
} from '@/lib/api'

type LogLevel = 'info' | 'ok' | 'warn' | 'error'

interface LogEntry {
  id: number
  level: LogLevel
  text: string
  time: string
}

interface Config {
  gcalSyncDays: number
  gcalSyncForce: boolean
  apiKey: string
}

const LOG_COLOR: Record<LogLevel, string> = {
  info:  '#93c5fd',
  ok:    '#86efac',
  warn:  '#fde68a',
  error: '#fca5a5',
}

const TABS = [
  { href: '/calendar',     label: '📅 Calendar' },
  { href: '/upcoming',     label: '📋 Upcoming' },
  { href: '/credit-cards', label: '💳 Credit Cards' },
  { href: '/tasks',        label: '✅ Tasks' },
  { href: '/grocery',      label: '🛒 Grocery' },
  { href: '/config',       label: '⚙️ Config' },
]

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function AppHeader() {
  const pathname = usePathname()
  const [darkMode, setDarkMode]           = useState(true)
  const [config, setConfig]               = useState<Config>({ gcalSyncDays: 365, gcalSyncForce: false, apiKey: '' })
  const [gcalAuth, setGcalAuth]           = useState<boolean | null>(null)
  const [syncing, setSyncing]             = useState(false)
  const [gcalSyncing, setGcalSyncing]     = useState(false)
  const [gcalDeleting, setGcalDeleting]   = useState(false)
  const [gcalWiping, setGcalWiping]       = useState(false)
  const [gtasksSyncing, setGtasksSyncing] = useState(false)
  const [logs, setLogs]                   = useState<LogEntry[]>([])
  const [logCount, setLogCount]           = useState(0)
  const logEndRef                         = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('theme')
    const dark = saved !== null ? saved === 'dark' : true
    setDarkMode(dark)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => { setConfig(loadConfig()) }, [])

  const addLog = useCallback((level: LogLevel, text: string): number => {
    const id = Date.now() + Math.random()
    setLogs(prev => [...prev, { id, level, text, time: timestamp() }])
    setLogCount(c => c + 1)
    return id
  }, [])

  const updateLog = useCallback((id: number, text: string) => {
    setLogs(prev => prev.map(entry => entry.id === id ? { ...entry, text } : entry))
  }, [])

  useEffect(() => {
    gcalAuthStatus()
      .then((s: { authenticated: boolean; email?: string }) => {
        setGcalAuth(s.authenticated)
        addLog('info', `Google auth status: ${s.authenticated ? `authenticated (${s.email || 'no email'})` : 'not authenticated'}`)
      })
      .catch(() => setGcalAuth(false))
  }, [addLog])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logCount])

  const handleGenerate = async () => {
    setSyncing(true)
    addLog('info', 'Generating occurrences…')
    try {
      const res = await generateAll()
      addLog('ok', `Generated ${res.occurrences_created} new occurrences across ${res.events_processed} events.`)
    } catch (e) {
      addLog('error', `Generate failed: ${errMsg(e)}`)
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
      const res = await syncToGcal(config.gcalSyncDays, config.gcalSyncForce, (data: { type: string; total?: number; msg?: string }) => {
        if (data.type === 'start') updateLog(progressId, `[gcal sync] 0/${data.total} starting…`)
        else if (data.type === 'progress') updateLog(progressId, `[gcal sync] ${data.msg}`)
      })
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      const level: LogLevel = res.failed > 0 ? 'warn' : 'ok'
      addLog(level, `Synced ${res.synced} events to Google Calendar.${res.failed ? ` ${res.failed} failed.` : ''}`)
      if (res.failed > 0) {
        const quotaErrors = (res.errors as string[] | undefined)?.filter((e: string) => e.includes('quotaExceeded') || e.includes('Quota Exceeded')) ?? []
        if (quotaErrors.length > 0) {
          addLog('warn', 'Google Calendar API quota exceeded — daily limit reached.')
        } else {
          addLog('warn', `${res.failed} event(s) failed to sync — you may need to reconnect Google.`)
          ;(res.errors as string[] | undefined)?.slice(0, 5).forEach((err: string) => addLog('error', err))
        }
      }
    } catch (e) {
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      addLog('error', `Google Calendar sync failed: ${errMsg(e)}`)
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
      addLog('error', `Delete failed: ${errMsg(e)}`)
    } finally {
      setGcalDeleting(false)
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
      addLog('error', `Wipe failed: ${errMsg(e)}`)
    } finally {
      setGcalWiping(false)
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
      const res = await syncToGtasks((data: { type: string; total?: number; msg?: string }) => {
        if (data.type === 'start') updateLog(progressId, `[gtasks sync] 0/${data.total} starting…`)
        else if (data.type === 'progress') updateLog(progressId, `[gtasks sync] ${data.msg}`)
      })
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      const level: LogLevel = res.failed > 0 ? 'warn' : 'ok'
      addLog(level, `Synced ${res.synced} tasks to Google Tasks.${res.failed ? ` ${res.failed} failed.` : ''}`)
      if (res.failed > 0) {
        const quotaErrors = (res.errors as string[] | undefined)?.filter((e: string) => e.includes('quotaExceeded') || e.includes('Quota Exceeded')) ?? []
        if (quotaErrors.length > 0) {
          addLog('warn', 'Google Tasks API quota exceeded — daily limit reached.')
        } else {
          addLog('warn', `${res.failed} task(s) failed to sync — you may need to reconnect Google.`)
          ;(res.errors as string[] | undefined)?.slice(0, 5).forEach((err: string) => addLog('error', err))
        }
      }
    } catch (e) {
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      addLog('error', `Google Tasks sync failed: ${errMsg(e)}`)
    } finally {
      setGtasksSyncing(false)
    }
  }

  const isCalendar = pathname === '/calendar'
  const isTasks    = pathname === '/tasks'

  return (
    <>
      <header>
        <h1>📅 Calendar App</h1>
        <nav>
          {TABS.map(t => (
            <Link
              key={t.href}
              href={t.href}
              className={pathname === t.href ? 'active' : ''}
              title={`Switch to ${t.label} view`}
            >
              {t.label}
            </Link>
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
          {isCalendar && (
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
          {isCalendar && (
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
          {isCalendar && gcalAuth && (
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
          {isCalendar && gcalAuth && (
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
          {isTasks && (
            <div id="task-toolbar-slot" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} />
          )}
          {isTasks && (
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
    </>
  )
}
