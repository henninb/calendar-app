const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return null
  return res.json()
}

export const fetchCategories = () => request('/categories')

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

export const fetchCreditCardTracker = () => request('/credit-cards/tracker')

export const generateAll = () =>
  request('/occurrences/generate-all', { method: 'POST' })

export const createTaskFromOccurrence = (occId) =>
  request(`/occurrences/${occId}/task`, { method: 'POST' })

export const gcalAuthStatus = () => request('/sync/auth/status')

export const syncToGcal = async (daysAhead = 365, force = false, onProgress) => {
  const res = await fetch(`${BASE}/sync/gcal?days_ahead=${daysAhead}&force=${force}`, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
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
      const data = JSON.parse(part.slice(6))
      if (data.type === 'done') finalResult = data
      else onProgress?.(data)
    }
  }
  return finalResult
}

export const deleteAllGcalEvents = () =>
  request('/sync/gcal', { method: 'DELETE' })

export const wipeAllGcalEvents = () =>
  request('/sync/gcal/wipe-all', { method: 'DELETE' })

export const syncToGtasks = async (onProgress) => {
  const res = await fetch(`${BASE}/sync/gtasks`, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
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
      const data = JSON.parse(part.slice(6))
      if (data.type === 'done') finalResult = data
      else onProgress?.(data)
    }
  }
  return finalResult
}

// ── Tasks ──────────────────────────────────────────────────────────────────

export const fetchTasks = (params = {}) => {
  const q = new URLSearchParams({ limit: 500, ...params })
  return request(`/tasks?${q}`)
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

export const fetchPersons = () => request('/persons')
