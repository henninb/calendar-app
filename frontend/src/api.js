const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {}
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

// #19, #23: shared SSE streaming helper — eliminates duplication between syncToGcal / syncToGtasks
// and uses the same error-extraction logic as request()
async function streamSSE(url, onProgress) {
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {}
    throw new Error(detail)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop()
    for (const part of parts) {
      if (!part.startsWith('data: ')) continue
      try {
        const data = JSON.parse(part.slice(6))
        if (data.type === 'done') finalResult = data
        else onProgress?.(data)
      } catch (e) {
        console.error('SSE parse error:', e, part)
      }
    }
  }
  return finalResult
}

// #13: signal parameter added so callers can abort in-flight requests
export const fetchCategories = (signal) => request('/categories', { signal })

export const fetchOccurrences = (params = {}) => {
  const q = new URLSearchParams({ limit: 500, ...params })
  return request(`/occurrences?${q}`)
}

export const updateOccurrence = (id, data) =>
  request(`/occurrences/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

export const deleteOccurrence = (id) =>
  request(`/occurrences/${id}`, { method: 'DELETE' })

export const fetchCreditCardTracker = () => request('/credit-cards/tracker')

export const generateAll = () =>
  request('/occurrences/generate-all', { method: 'POST' })

export const createTaskFromOccurrence = (occId) =>
  request(`/occurrences/${occId}/task`, { method: 'POST' })

export const gcalAuthStatus = () => request('/sync/auth/status')

// #19: refactored to use streamSSE
export const syncToGcal = (daysAhead = 365, force = false, onProgress) =>
  streamSSE(`${BASE}/sync/gcal?days_ahead=${daysAhead}&force=${force}`, onProgress)

export const deleteAllGcalEvents = () =>
  request('/sync/gcal', { method: 'DELETE' })

export const wipeAllGcalEvents = () =>
  request('/sync/gcal/wipe-all', {
    method: 'DELETE',
    headers: { 'X-Confirm-Delete': 'yes' },
  })

// #19: refactored to use streamSSE
export const syncToGtasks = (onProgress) =>
  streamSSE(`${BASE}/sync/gtasks`, onProgress)

// ── Tasks ──────────────────────────────────────────────────────────────────

// #13: signal parameter for AbortController support
export const fetchTasks = (params = {}, signal) => {
  const q = new URLSearchParams({ limit: 500, ...params })
  return request(`/tasks?${q}`, { signal })
}

export const createTask = (data) =>
  request('/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

export const updateTask = (id, data) =>
  request(`/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

export const deleteTask = (id) =>
  request(`/tasks/${id}`, { method: 'DELETE' })

// ── Subtasks ───────────────────────────────────────────────────────────────

export const createSubtask = (taskId, data) =>
  request(`/tasks/${taskId}/subtasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

export const updateSubtask = (taskId, subtaskId, data) =>
  request(`/tasks/${taskId}/subtasks/${subtaskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

export const deleteSubtask = (taskId, subtaskId) =>
  request(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'DELETE' })

// ── Persons ────────────────────────────────────────────────────────────────

// #13: signal parameter for AbortController support
export const fetchPersons = (signal) => request('/persons', { signal })
