'use client'
import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { gcalAuthStatus, wipeAllGcalEvents } from '@/lib/api'

export interface Config {
  gcalSyncDays: number
  gcalSyncForce: boolean
  apiKey: string
}

export const CONFIG_DEFAULTS: Config = {
  gcalSyncDays: 365,
  gcalSyncForce: false,
  apiKey: '',
}

export function loadConfig(): Config {
  if (typeof window === 'undefined') return { ...CONFIG_DEFAULTS }
  try {
    return { ...CONFIG_DEFAULTS, ...JSON.parse(localStorage.getItem('calendarConfig') || '{}') }
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

export default function ConfigPage() {
  const [form, setForm]         = useState<Config>(CONFIG_DEFAULTS)
  const [gcalAuth, setGcalAuth] = useState<boolean | null>(null)
  const [saved, setSaved]       = useState(false)
  const [gcalWiping, setGcalWiping] = useState(false)
  const [wipeResult, setWipeResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const savedTimerRef           = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setForm(loadConfig()) }, [])

  useEffect(() => {
    gcalAuthStatus().then((s: { authenticated: boolean }) => setGcalAuth(s.authenticated)).catch(() => setGcalAuth(false))
  }, [])

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  const handleSave = () => {
    localStorage.setItem('calendarConfig', JSON.stringify(form))
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => { setForm(CONFIG_DEFAULTS) }

  const handleGcalWipe = async () => {
    if (!gcalAuth) return
    if (!window.confirm('Delete ALL events from your primary Google Calendar? This includes events not created by this app and cannot be undone.')) return
    setGcalWiping(true)
    setWipeResult(null)
    try {
      const res = await wipeAllGcalEvents()
      setWipeResult({ ok: true, msg: res.message || 'Wipe started in background.' })
    } catch (e) {
      setWipeResult({ ok: false, msg: (e as Error).message })
    } finally {
      setGcalWiping(false)
    }
  }

  const fieldLabel = (label: string, description: string): ReactNode => (
    <div style={{ marginBottom: '.2rem' }}>
      <div style={{ fontWeight: 600, color: 'var(--color-text-muted)', fontSize: '.875rem' }}>{label}</div>
      <div style={{ fontSize: '.75rem', color: 'var(--color-text-dim)' }}>{description}</div>
    </div>
  )

  return (
    <div className="card" style={{ maxWidth: 500 }}>
      <h2 style={{ marginBottom: '1.5rem', fontSize: '1rem', fontWeight: 700 }}>Configuration</h2>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{
          fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.08em',
          color: 'var(--color-text-dim)', fontWeight: 700, marginBottom: '1rem',
          borderBottom: '1px solid var(--color-border)', paddingBottom: '.4rem',
        }}>
          Google Account
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.875rem', color: gcalAuth ? '#16a34a' : '#dc2626' }}>
            {gcalAuth === null ? 'Checking…' : gcalAuth ? 'Connected' : 'Not connected'}
          </span>
          <button
            className="btn btn-blue"
            style={{ fontSize: '.8rem' }}
            onClick={() => { window.location.href = '/api/sync/auth' }}
          >
            {gcalAuth ? 'Reconnect Google' : 'Connect Google'}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{
          fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.08em',
          color: 'var(--color-text-dim)', fontWeight: 700, marginBottom: '1rem',
          borderBottom: '1px solid var(--color-border)', paddingBottom: '.4rem',
        }}>
          Google Calendar Sync
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {fieldLabel('Days Ahead', 'How many days ahead to sync occurrences to Google Calendar (1–730)')}
            <input
              type="number"
              min="1"
              max="730"
              value={form.gcalSyncDays}
              onChange={e => setForm(f => ({
                ...f,
                gcalSyncDays: Math.max(1, Math.min(730, parseInt(e.target.value) || 1)),
              }))}
              style={{
                border: '1px solid var(--color-input-border)', borderRadius: 6,
                padding: '.35rem .65rem', fontSize: '.875rem',
                background: 'var(--color-input-bg)', color: 'var(--color-text)', width: 100,
              }}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.gcalSyncForce}
              onChange={e => setForm(f => ({ ...f, gcalSyncForce: e.target.checked }))}
              style={{ marginTop: '.2rem', accentColor: '#3b82f6', width: 15, height: 15, flexShrink: 0 }}
            />
            {fieldLabel('Force Sync', 'Re-sync all occurrences, overwriting already-synced Google Calendar events. Uncheck to only push new events.')}
          </label>
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{
          fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.08em',
          color: 'var(--color-text-dim)', fontWeight: 700, marginBottom: '1rem',
          borderBottom: '1px solid var(--color-border)', paddingBottom: '.4rem',
        }}>
          Authentication
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {fieldLabel('API Key', 'Sent as X-Api-Key on every request. Leave blank if the server has no API_KEY set.')}
          <input
            type="password"
            value={form.apiKey}
            onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
            placeholder="(none)"
            autoComplete="off"
            style={{
              border: '1px solid var(--color-input-border)', borderRadius: 6,
              padding: '.35rem .65rem', fontSize: '.875rem',
              background: 'var(--color-input-bg)', color: 'var(--color-text)', width: '100%',
            }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '2rem' }}>
        <button className="btn btn-blue" onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save'}
        </button>
        <button className="btn btn-gray" onClick={handleReset}>
          Reset to Defaults
        </button>
      </div>

      <div>
        <div style={{
          fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.08em',
          color: '#dc2626', fontWeight: 700, marginBottom: '1rem',
          borderBottom: '1px solid #fca5a5', paddingBottom: '.4rem',
        }}>
          Danger Zone
        </div>
        <div style={{
          padding: '1rem', borderRadius: 8,
          border: '1px solid #fca5a5',
          background: 'var(--color-overdue-row)',
        }}>
          {fieldLabel(
            'Wipe Google Calendar',
            'Permanently deletes ALL events from your primary Google Calendar, including events not created by this app. This cannot be undone.'
          )}
          <div style={{ marginTop: '.75rem', display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
            <button
              className="btn"
              style={{ background: '#dc2626', color: '#fff', fontSize: '.8rem', opacity: (!gcalAuth || gcalWiping) ? 0.5 : 1 }}
              disabled={!gcalAuth || gcalWiping}
              onClick={handleGcalWipe}
              title={gcalAuth ? 'Delete ALL events from your primary Google Calendar' : 'Connect Google first'}
            >
              {gcalWiping ? 'Wiping…' : '💣 Wipe Google Calendar'}
            </button>
            {!gcalAuth && (
              <span style={{ fontSize: '.8rem', color: 'var(--color-text-dim)' }}>Connect Google first.</span>
            )}
            {wipeResult && (
              <span style={{ fontSize: '.8rem', color: wipeResult.ok ? '#16a34a' : '#dc2626' }}>
                {wipeResult.ok ? `✓ ${wipeResult.msg}` : wipeResult.msg}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
