import React, { useState } from 'react'

export const CONFIG_DEFAULTS = {
  gcalSyncDays: 365,
  gcalSyncForce: false,
}

export function loadConfig() {
  try {
    return { ...CONFIG_DEFAULTS, ...JSON.parse(localStorage.getItem('calendarConfig') || '{}') }
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

export default function ConfigPage({ config, onSave, gcalAuth }) {
  const [form, setForm] = useState(config)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    localStorage.setItem('calendarConfig', JSON.stringify(form))
    onSave(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setForm(CONFIG_DEFAULTS)
  }

  const fieldLabel = (label, description) => (
    <div style={{ marginBottom: '.2rem' }}>
      <div style={{ fontWeight: 600, color: '#475569', fontSize: '.875rem' }}>{label}</div>
      <div style={{ fontSize: '.75rem', color: '#94a3b8' }}>{description}</div>
    </div>
  )

  return (
    <div className="card" style={{ maxWidth: 500 }}>
      <h2 style={{ marginBottom: '1.5rem', fontSize: '1rem', fontWeight: 700 }}>Configuration</h2>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{
          fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.08em',
          color: '#94a3b8', fontWeight: 700, marginBottom: '1rem',
          borderBottom: '1px solid #e2e8f0', paddingBottom: '.4rem',
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
          color: '#94a3b8', fontWeight: 700, marginBottom: '1rem',
          borderBottom: '1px solid #e2e8f0', paddingBottom: '.4rem',
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
                border: '1px solid #cbd5e1', borderRadius: 6,
                padding: '.35rem .65rem', fontSize: '.875rem',
                background: '#fff', width: 100,
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

      <div style={{ display: 'flex', gap: '.5rem' }}>
        <button className="btn btn-blue" onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save'}
        </button>
        <button className="btn btn-gray" onClick={handleReset}>
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}
