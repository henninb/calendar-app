'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { loadConfig, type Config } from '@/components/ConfigPage'
import {
  gcalAuthStatus, generateAll, syncToGcal,
  deleteAllGcalEvents,
  type SyncResult,
} from '@/lib/api'

type LogLevel = 'info' | 'ok' | 'warn' | 'error'

interface LogEntry {
  id: number
  level: LogLevel
  text: string
  time: string
}

const LOG_COLOR: Record<LogLevel, string> = {
  info: '#93c5fd', ok: '#86efac', warn: '#fde68a', error: '#fca5a5',
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

export default function CalendarActions() {
  const [config, setConfig]             = useState<Config>({ gcalSyncDays: 365, gcalSyncForce: false, apiKey: '' })
  const [syncing, setSyncing]           = useState(false)
  const [gcalSyncing, setGcalSyncing]   = useState(false)
  const [gcalDeleting, setGcalDeleting] = useState(false)
  const [gcalAuth, setGcalAuth]         = useState<boolean | null>(null)
  const [logs, setLogs]                 = useState<LogEntry[]>([])
  const [logCount, setLogCount]         = useState(0)
  const logEndRef                       = useRef<HTMLDivElement>(null)

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
      addLog('error', `Generate failed: ${(e as Error).message}`)
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
      const res: SyncResult = await syncToGcal(config.gcalSyncDays, config.gcalSyncForce, (data) => {
        if (data.type === 'start') {
          updateLog(progressId, `[gcal sync] 0/${data.total} starting…`)
        } else if (data.type === 'progress') {
          updateLog(progressId, `[gcal sync] ${data.msg}`)
        }
      })
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      const level: LogLevel = res.failed > 0 ? 'warn' : 'ok'
      addLog(level, `Synced ${res.synced} events to Google Calendar.${res.failed ? ` ${res.failed} failed.` : ''}`)
      if (res.failed > 0) {
        const quotaErrors = res.errors?.filter(e => e.includes('quotaExceeded') || e.includes('Quota Exceeded')) ?? []
        if (quotaErrors.length > 0) {
          addLog('warn', 'Google Calendar API quota exceeded — daily limit reached. Try again tomorrow or increase your quota in the Google Cloud Console.')
        } else {
          addLog('warn', `${res.failed} event(s) failed to sync — you may need to reconnect Google.`)
          res.errors?.slice(0, 5).forEach(err => addLog('error', err))
        }
      }
    } catch (e) {
      setLogs(prev => prev.filter(entry => entry.id !== progressId))
      addLog('error', `Google Calendar sync failed: ${(e as Error).message}`)
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
      addLog('error', `Delete failed: ${(e as Error).message}`)
    } finally {
      setGcalDeleting(false)
    }
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: logs.length > 0 ? '.5rem' : 0, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn btn-blue"
          style={{ fontSize: '.8rem' }}
          disabled={syncing}
          onClick={handleGenerate}
          title="Generate occurrences for all active events"
        >
          {syncing ? 'Generating…' : '⟳ Generate'}
        </button>
        <button
          className="btn btn-blue"
          style={{ fontSize: '.8rem', background: gcalAuth ? '#16a34a' : '#2563eb' }}
          disabled={gcalSyncing}
          onClick={handleGcalSync}
          title={gcalAuth ? `Push events to Google Calendar (force=${config.gcalSyncForce}, ${config.gcalSyncDays} days)` : 'Connect your Google account to enable calendar sync'}
        >
          {gcalSyncing ? 'Syncing…' : gcalAuth ? '📅 Sync to Google Calendar' : '🔗 Connect Google'}
        </button>
        {gcalAuth && (
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
      </div>

      {logs.length > 0 && (
        <div style={{ position: 'relative', background: '#0f172a', borderBottom: '1px solid #1e293b', borderRadius: '6px', marginBottom: '.5rem' }}>
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
    </div>
  )
}
