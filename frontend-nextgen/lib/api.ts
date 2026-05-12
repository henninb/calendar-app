const BASE = '/api'
const JSON_H: HeadersInit = { 'Content-Type': 'application/json' }

function apiKeyHeader(): Record<string, string> {
  try {
    const cfg = JSON.parse(localStorage.getItem('calendarConfig') || '{}')
    return cfg.apiKey ? { 'X-Api-Key': cfg.apiKey } : {}
  } catch {
    return {}
  }
}

async function extractErrorDetail(res: Response): Promise<string> {
  let detail = `${res.status} ${res.statusText}`
  try {
    const body = await res.json()
    if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
  } catch {}
  return detail
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function request(path: string, options: RequestInit = {}): Promise<any> {
  const opts: RequestInit = {
    ...options,
    headers: { ...apiKeyHeader(), ...(options.headers as Record<string, string>) },
  }
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) throw new Error(await extractErrorDetail(res))
  if (res.status === 204) return null
  return res.json()
}

export interface SSEProgressData {
  type: string
  [key: string]: unknown
}

export interface SyncResult {
  type: 'done'
  synced: number
  failed: number
  errors?: string[]
}

async function streamSSE(
  url: string,
  onProgress: ((data: SSEProgressData) => void) | undefined,
  signal?: AbortSignal,
): Promise<SSEProgressData> {
  const res = await fetch(url, { method: 'POST', headers: apiKeyHeader(), signal })
  if (!res.ok) throw new Error(await extractErrorDetail(res))
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: SSEProgressData | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop()!
    for (const part of parts) {
      if (!part.startsWith('data: ')) continue
      try {
        const data: SSEProgressData = JSON.parse(part.slice(6))
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

const FETCH_LIMIT = 1000

export const fetchCategories = (signal?: AbortSignal) => request('/categories', { signal })

export const createEvent = (data: unknown) =>
  request('/events', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })

export const fetchOccurrences = (params: Record<string, string | number> = {}) => {
  const stringified = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const q = new URLSearchParams({ limit: String(FETCH_LIMIT), ...stringified })
  return request(`/occurrences?${q}`)
}

export const updateOccurrence = (id: number, data: unknown) =>
  request(`/occurrences/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })

export const deleteOccurrence = (id: number) =>
  request(`/occurrences/${id}`, { method: 'DELETE' })

export const fetchCreditCardTracker = () => request('/credit-cards/tracker')

export const createCreditCard = (data: unknown) =>
  request('/credit-cards', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })

export const generateAll = () =>
  request('/occurrences/generate-all', { method: 'POST' })

export const createTaskFromOccurrence = (occId: number) =>
  request(`/occurrences/${occId}/task`, { method: 'POST' })

export const gcalAuthStatus = () => request('/sync/auth/status')

export const syncToGcal = (
  daysAhead = 365,
  force = false,
  onProgress?: (data: SSEProgressData) => void,
  signal?: AbortSignal,
): Promise<SyncResult> =>
  streamSSE(`${BASE}/sync/gcal?days_ahead=${daysAhead}&force=${force}`, onProgress, signal) as unknown as Promise<SyncResult>

export const deleteAllGcalEvents = () =>
  request('/sync/gcal', { method: 'DELETE' })

export const wipeAllGcalEvents = () =>
  request('/sync/gcal/wipe-all', {
    method: 'DELETE',
    headers: { 'X-Confirm-Delete': 'yes' },
  })

export const syncToGtasks = (
  onProgress?: (data: SSEProgressData) => void,
  signal?: AbortSignal,
): Promise<SyncResult> =>
  streamSSE(`${BASE}/sync/gtasks`, onProgress, signal) as unknown as Promise<SyncResult>

// ── Tasks ──────────────────────────────────────────────────────────────────

export const fetchTasks = (params: Record<string, string> = {}, signal?: AbortSignal) => {
  const q = new URLSearchParams({ limit: String(FETCH_LIMIT), ...params })
  return request(`/tasks?${q}`, { signal })
}

export const createTask = (data: unknown) =>
  request('/tasks', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })

export const updateTask = (id: number, data: unknown) =>
  request(`/tasks/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })

export const deleteTask = (id: number) =>
  request(`/tasks/${id}`, { method: 'DELETE' })

// ── Subtasks ───────────────────────────────────────────────────────────────

export const createSubtask = (taskId: number, data: unknown) =>
  request(`/tasks/${taskId}/subtasks`, { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })

export const updateSubtask = (taskId: number, subtaskId: number, data: unknown) =>
  request(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })

export const deleteSubtask = (taskId: number, subtaskId: number) =>
  request(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'DELETE' })

// ── Persons ────────────────────────────────────────────────────────────────

export const fetchPersons = (signal?: AbortSignal) => request('/persons', { signal })

// ── Stores ────────────────────────────────────────────────────────────────

export const fetchStores = () => request('/stores')
export const createStore = (data: unknown) =>
  request('/stores', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })
export const updateStore = (id: number, data: unknown) =>
  request(`/stores/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })
export const deleteStore = (id: number) =>
  request(`/stores/${id}`, { method: 'DELETE' })

// ── Grocery Items (catalog) ───────────────────────────────────────────────

export const fetchGroceryItems = (params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params)
  return request(`/grocery/items${q.size ? `?${q}` : ''}`)
}
export const createGroceryItem = (data: unknown) =>
  request('/grocery/items', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })
export const updateGroceryItem = (id: number, data: unknown) =>
  request(`/grocery/items/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })
export const deleteGroceryItem = (id: number) =>
  request(`/grocery/items/${id}`, { method: 'DELETE' })

// ── On Hand ───────────────────────────────────────────────────────────────

export const fetchOnHand = () => request('/grocery/on-hand')
export const upsertOnHand = (itemId: number, data: unknown) =>
  request(`/grocery/on-hand/${itemId}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify(data) })
export const deleteOnHand = (itemId: number) =>
  request(`/grocery/on-hand/${itemId}`, { method: 'DELETE' })

// ── Grocery Lists ─────────────────────────────────────────────────────────

export const fetchGroceryLists = (params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params)
  return request(`/grocery/lists${q.size ? `?${q}` : ''}`)
}
export const fetchGroceryList = (id: number) => request(`/grocery/lists/${id}`)
export const createGroceryList = (data: unknown) =>
  request('/grocery/lists', { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })
export const updateGroceryList = (id: number, data: unknown) =>
  request(`/grocery/lists/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })
export const deleteGroceryList = (id: number) =>
  request(`/grocery/lists/${id}`, { method: 'DELETE' })

// ── Grocery List Items ────────────────────────────────────────────────────

export const addGroceryListItem = (listId: number, data: unknown) =>
  request(`/grocery/lists/${listId}/items`, { method: 'POST', headers: JSON_H, body: JSON.stringify(data) })
export const updateGroceryListItem = (listId: number, itemId: number, data: unknown) =>
  request(`/grocery/lists/${listId}/items/${itemId}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(data) })
export const removeGroceryListItem = (listId: number, itemId: number) =>
  request(`/grocery/lists/${listId}/items/${itemId}`, { method: 'DELETE' })
