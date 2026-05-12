'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { gcalAuthStatus, syncToGtasks } from '@/lib/api'

const LOG_COLOR = { info: '#93c5fd', ok: '#86efac', warn: '#fde68a', error: '#fca5a5' }

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

export default function TasksActions() {
  const [gtasksSyncing, setGtasksSyncing] = useState(false)
  const [gcalAuth, setGcalAuth]           = useState(null)
  const [logs, setLogs]                   = useState([])
  const [logCount, setLogCount]           = useState(0)
  const logEndRef                         = useRef(null)

  useEffect(() => {
    gcalAuthStatus().then(s => setGcalAuth(s.authenticated)).catch(() => setGcalAuth(false))
  }, [])

  const addLog = useCallback((level, text) => {
    const id = Date.now() + Math.random()
    setLogs(prev => [...prev, { id, level, text, time: timestamp() }])
    setLogCount(c => c + 1)
    return id
  }, [])

  const updateLog = useCallback((id, text) => {
    setLogs(prev => prev.map(entry => entry.id === id ? { ...entry, text } : entry))
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logCount])

  const handleGtasksSync = async () => {
    if (!gcalAuth) {
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
          addLog('warn', `Google Tasks API quota exceeded — daily limit reached.`)
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

  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', flexWrap: 'wrap' }}>
        <button
          className="btn btn-blue"
          style={{ fontSize: '.8rem', background: gcalAuth ? '#7c3aed' : '#2563eb' }}
          disabled={gtasksSyncing}
          onClick={handleGtasksSync}
          title={gcalAuth ? 'Sync tasks to Google Tasks' : 'Connect your Google account to enable Google Tasks sync'}
        >
          {gtasksSyncing ? 'Syncing…' : '✅ Google Sync'}
        </button>
      </div>

      {logs.length > 0 && (
        <div style={{ position: 'relative', background: '#0f172a', borderRadius: '6px', marginTop: '.5rem' }}>
          <button
            onClick={() => setLogs([])}
            title="Clear log"
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
            padding: '.5rem 2rem .5rem 1rem', maxHeight: '6rem', overflowY: 'auto',
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
