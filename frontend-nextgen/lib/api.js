const BASE = '/api'
const JSON_H = { 'Content-Type': 'application/json' }

function apiKeyHeader() {
  try {
    const cfg = JSON.parse(localStorage.getItem('calendarConfig') || '{}')
    return cfg.apiKey ? { 'X-Api-Key': cfg.apiKey } : {}
  } catch {
    return {}
  }
}

async function extractErrorDetail(res) {
  let detail = `${res.status} ${res.statusText}`
  try {
    const body = await res.json()
    if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
  } catch {}
  return detail
}

async function request(path, options = {}) {
  const opts = {
    ...options,
    headers: { ...apiKeyHeader(), ...options.headers },
  }
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) throw new Error(await extractErrorDetail(res))
  if (res.status === 204) return null
  return res.json()
}

async function streamSSE(url, onProgress, signal) {
  const res = await fetch(url, { method: 'POST', headers: apiKeyHeader(), signal })
  if (!res.ok) throw new Error(await extractErrorDetail(res))
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
  if (!finalResult) throw new Error('Sync stream ended without a result — server may have crashed mid-sync')
  return finalResult
}

// Default fetch limit — matches backend max of 1000; callers can override via params
const FETCH_LIMIT = 500

export const fetchCategories = (signal) => request('/categories', { signal })

export const createEvent = (data) =>
  request('/events', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })

export const fetchOccurrences = (params = {}) => {
  const q = new URLSearchParams({ limit: FETCH_LIMIT, ...params })
  return request(`/occurrences?${q}`)
}

export const updateOccurrence = (id, data) =>
  request(`/occurrences/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })

export const deleteOccurrence = (id) =>
  request(`/occurrences/${id}`, { method: 'DELETE' })

export const fetchCreditCardTracker = () => request('/credit-cards/tracker')

export const createCreditCard = (data) =>
  request('/credit-cards', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })

export const generateAll = () =>
  request('/occurrences/generate-all', { method: 'POST' })

export const createTaskFromOccurrence = (occId) =>
  request(`/occurrences/${occId}/task`, { method: 'POST' })

export const gcalAuthStatus = () => request('/sync/auth/status')

export const syncToGcal = (daysAhead = 365, force = false, onProgress, signal) =>
  streamSSE(`${BASE}/sync/gcal?days_ahead=${daysAhead}&force=${force}`, onProgress, signal)

export const deleteAllGcalEvents = () =>
  request('/sync/gcal', { method: 'DELETE' })

export const wipeAllGcalEvents = () =>
  request('/sync/gcal/wipe-all', {
    method: 'DELETE',
    headers: { 'X-Confirm-Delete': 'yes' },
  })

export const syncToGtasks = (onProgress, signal) =>
  streamSSE(`${BASE}/sync/gtasks`, onProgress, signal)

// ── Tasks ──────────────────────────────────────────────────────────────────

export const fetchTasks = (params = {}, signal) => {
  const q = new URLSearchParams({ limit: FETCH_LIMIT, ...params })
  return request(`/tasks?${q}`, { signal })
}

export const createTask = (data) =>
  request('/tasks', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })

export const updateTask = (id, data) =>
  request(`/tasks/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })

export const deleteTask = (id) =>
  request(`/tasks/${id}`, { method: 'DELETE' })

// ── Subtasks ───────────────────────────────────────────────────────────────

export const createSubtask = (taskId, data) =>
  request(`/tasks/${taskId}/subtasks`, { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })

export const updateSubtask = (taskId, subtaskId, data) =>
  request(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })

export const deleteSubtask = (taskId, subtaskId) =>
  request(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'DELETE' })

// ── Persons ────────────────────────────────────────────────────────────────

export const fetchPersons = (signal) => request('/persons', { signal })

// ── Stores ────────────────────────────────────────────────────────────────

export const fetchStores = () => request('/stores')
export const createStore = (data) => request('/stores', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })
export const updateStore = (id, data) => request(`/stores/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })
export const deleteStore = (id) => request(`/stores/${id}`, { method: 'DELETE' })

// ── Grocery Items (catalog) ───────────────────────────────────────────────

export const fetchGroceryItems = (params = {}) => {
  const q = new URLSearchParams(params)
  return request(`/grocery/items${q.size ? `?${q}` : ''}`)
}
export const createGroceryItem = (data) => request('/grocery/items', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })
export const updateGroceryItem = (id, data) => request(`/grocery/items/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })
export const deleteGroceryItem = (id) => request(`/grocery/items/${id}`, { method: 'DELETE' })

// ── On Hand ───────────────────────────────────────────────────────────────

export const fetchOnHand = () => request('/grocery/on-hand')
export const upsertOnHand = (itemId, data) => request(`/grocery/on-hand/${itemId}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify(data) })
export const deleteOnHand = (itemId) => request(`/grocery/on-hand/${itemId}`, { method: 'DELETE' })

// ── Grocery Lists ─────────────────────────────────────────────────────────

export const fetchGroceryLists = (params = {}) => {
  const q = new URLSearchParams(params)
  return request(`/grocery/lists${q.size ? `?${q}` : ''}`)
}
export const fetchGroceryList = (id) => request(`/grocery/lists/${id}`)
export const createGroceryList = (data) => request('/grocery/lists', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })
export const updateGroceryList = (id, data) => request(`/grocery/lists/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })
export const deleteGroceryList = (id) => request(`/grocery/lists/${id}`, { method: 'DELETE' })

// ── Grocery List Items ────────────────────────────────────────────────────

export const addGroceryListItem = (listId, data) => request(`/grocery/lists/${listId}/items`, { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })
export const updateGroceryListItem = (listId, itemId, data) => request(`/grocery/lists/${listId}/items/${itemId}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })
export const removeGroceryListItem = (listId, itemId) => request(`/grocery/lists/${listId}/items/${itemId}`, { method: 'DELETE' })
