import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import * as api from '@/lib/api'

// ── localStorage mock ──────────────────────────────────────────────────────

const _store: Record<string, string> = {}
const storageMock: Storage = {
  getItem:    (k: string) => _store[k] ?? null,
  setItem:    (k: string, v: string) => { _store[k] = v },
  removeItem: (k: string) => { delete _store[k] },
  clear:      () => { Object.keys(_store).forEach(k => delete _store[k]) },
  key:        (i: number) => Object.keys(_store)[i] ?? null,
  get length() { return Object.keys(_store).length },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mockOkResponse(data: unknown, status = 200) {
  return {
    ok: true,
    status,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(data),
    body: null,
  } as unknown as Response
}

function mockErrResponse(data: unknown, status: number, statusText = 'Error') {
  return {
    ok: false,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(data),
    body: null,
  } as unknown as Response
}

function encodeSSE(...events: object[]) {
  const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')
  return new TextEncoder().encode(text)
}

function mockSSEResponse(events: object[]) {
  const chunk = encodeSSE(...events)
  let done = false
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (done) return Promise.resolve({ done: true as const, value: undefined })
      done = true
      return Promise.resolve({ done: false as const, value: chunk })
    }),
  }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: { getReader: () => reader },
    json: vi.fn().mockResolvedValue({}),
  } as unknown as Response
}

// ── Global fetch + localStorage mocks ─────────────────────────────────────

const mockFetch = vi.fn()

beforeAll(() => {
  vi.stubGlobal('fetch', mockFetch)
  vi.stubGlobal('localStorage', storageMock)
})
afterAll(() => { vi.unstubAllGlobals() })

beforeEach(() => {
  mockFetch.mockReset()
  storageMock.clear()
})

// ── apiKeyHeader ───────────────────────────────────────────────────────────

describe('api — apiKeyHeader', () => {
  it('includes X-Api-Key when apiKey is present in localStorage', async () => {
    localStorage.setItem('calendarConfig', JSON.stringify({ apiKey: 'my-key' }))
    mockFetch.mockResolvedValue(mockOkResponse({}))
    await api.fetchCategories()
    const [, opts] = mockFetch.mock.calls[0]
    expect((opts!.headers as Record<string, string>)['X-Api-Key']).toBe('my-key')
  })

  it('omits X-Api-Key when no apiKey in localStorage', async () => {
    mockFetch.mockResolvedValue(mockOkResponse({}))
    await api.fetchCategories()
    const [, opts] = mockFetch.mock.calls[0]
    expect((opts!.headers as Record<string, string>)['X-Api-Key']).toBeUndefined()
  })

  it('omits X-Api-Key when apiKey is empty string', async () => {
    localStorage.setItem('calendarConfig', JSON.stringify({ apiKey: '' }))
    mockFetch.mockResolvedValue(mockOkResponse({}))
    await api.fetchCategories()
    const [, opts] = mockFetch.mock.calls[0]
    expect((opts!.headers as Record<string, string>)['X-Api-Key']).toBeUndefined()
  })

  it('omits X-Api-Key when localStorage contains invalid JSON', async () => {
    localStorage.setItem('calendarConfig', 'not-json')
    mockFetch.mockResolvedValue(mockOkResponse({}))
    await expect(api.fetchCategories()).resolves.toBeDefined()
    const [, opts] = mockFetch.mock.calls[0]
    expect((opts!.headers as Record<string, string>)['X-Api-Key']).toBeUndefined()
  })
})

// ── request / extractErrorDetail ───────────────────────────────────────────

describe('api — request', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValue(mockOkResponse({ hello: 'world' }))
    const result = await api.fetchCategories()
    expect(result).toEqual({ hello: 'world' })
  })

  it('returns null for 204 No Content', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    const result = await api.deleteOccurrence(1)
    expect(result).toBeNull()
  })

  it('throws with string detail from error body', async () => {
    mockFetch.mockResolvedValue(mockErrResponse({ detail: 'Item not found' }, 404))
    await expect(api.fetchCategories()).rejects.toThrow('Item not found')
  })

  it('throws with serialized object detail from error body', async () => {
    mockFetch.mockResolvedValue(mockErrResponse({ detail: [{ loc: ['body'], msg: 'field required' }] }, 422))
    await expect(api.fetchCategories()).rejects.toThrow('[{')
  })

  it('falls back to status + statusText when error body has no detail', async () => {
    mockFetch.mockResolvedValue(mockErrResponse({}, 500, 'Internal Server Error'))
    await expect(api.fetchCategories()).rejects.toThrow('500 Internal Server Error')
  })

  it('falls back to status + statusText when error body json() throws', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: vi.fn().mockRejectedValue(new Error('no body')),
    } as unknown as Response)
    await expect(api.fetchCategories()).rejects.toThrow('503 Service Unavailable')
  })
})

// ── streamSSE ──────────────────────────────────────────────────────────────

describe('api — streamSSE via syncToGtasks', () => {
  it('returns finalResult on successful stream', async () => {
    mockFetch.mockResolvedValue(mockSSEResponse([
      { type: 'start', total: 3 },
      { type: 'progress', msg: '1/3' },
      { type: 'done', synced: 3, failed: 0 },
    ]))
    const result = await api.syncToGtasks()
    expect(result).toMatchObject({ type: 'done', synced: 3, failed: 0 })
  })

  it('calls onProgress for non-done events', async () => {
    mockFetch.mockResolvedValue(mockSSEResponse([
      { type: 'start', total: 2 },
      { type: 'progress', msg: '1/2' },
      { type: 'done', synced: 2, failed: 0 },
    ]))
    const onProgress = vi.fn()
    await api.syncToGtasks(onProgress)
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenCalledWith({ type: 'start', total: 2 })
    expect(onProgress).toHaveBeenCalledWith({ type: 'progress', msg: '1/2' })
  })

  it('throws when stream ends without a done event', async () => {
    mockFetch.mockResolvedValue(mockSSEResponse([{ type: 'start', total: 1 }]))
    await expect(api.syncToGtasks()).rejects.toThrow('Sync stream ended without a result')
  })

  it('throws when SSE response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: vi.fn().mockResolvedValue({ detail: 'SSE failed' }),
    } as unknown as Response)
    await expect(api.syncToGtasks()).rejects.toThrow('SSE failed')
  })

  it('handles invalid JSON lines in SSE stream gracefully', async () => {
    const encoder = new TextEncoder()
    const badChunk = encoder.encode('data: not-json\n\ndata: {"type":"done","synced":1,"failed":0}\n\n')
    let done = false
    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (done) return Promise.resolve({ done: true as const, value: undefined })
        done = true
        return Promise.resolve({ done: false as const, value: badChunk })
      }),
    }
    mockFetch.mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      body: { getReader: () => reader },
      json: vi.fn(),
    } as unknown as Response)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await api.syncToGtasks()
    expect(result).toMatchObject({ type: 'done', synced: 1 })
    consoleSpy.mockRestore()
  })
})

// ── syncToGcal ─────────────────────────────────────────────────────────────

describe('api — syncToGcal', () => {
  it('calls the gcal SSE endpoint with days_ahead and force params', async () => {
    mockFetch.mockResolvedValue(mockSSEResponse([{ type: 'done', synced: 5, failed: 0 }]))
    await api.syncToGcal(30, true)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('/api/sync/gcal')
    expect(url).toContain('days_ahead=30')
    expect(url).toContain('force=true')
  })

  it('uses defaults of 365 days and force=false', async () => {
    mockFetch.mockResolvedValue(mockSSEResponse([{ type: 'done', synced: 0, failed: 0 }]))
    await api.syncToGcal()
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('days_ahead=365')
    expect(url).toContain('force=false')
  })
})

// ── Occurrence endpoints ───────────────────────────────────────────────────

describe('api — occurrence endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse([])) })

  it('fetchOccurrences calls GET /api/occurrences with limit', async () => {
    await api.fetchOccurrences()
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('/api/occurrences')
    expect(url).toContain('limit=1000')
  })

  it('fetchOccurrences merges extra params into query string', async () => {
    await api.fetchOccurrences({ month: '2026-05', category_id: 3 })
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('month=2026-05')
    expect(url).toContain('category_id=3')
  })

  it('createEvent posts to /api/events', async () => {
    await api.createEvent({ name: 'Test' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/events')
    expect(opts?.method).toBe('POST')
    expect(opts?.body).toBe(JSON.stringify({ name: 'Test' }))
  })

  it('updateOccurrence patches the right path', async () => {
    await api.updateOccurrence(42, { note: 'hi' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/occurrences/42')
    expect(opts?.method).toBe('PATCH')
  })

  it('deleteOccurrence deletes the right path and returns null', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    const result = await api.deleteOccurrence(7)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/occurrences/7')
    expect(opts?.method).toBe('DELETE')
    expect(result).toBeNull()
  })

  it('generateAll posts to /api/occurrences/generate-all', async () => {
    await api.generateAll()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/occurrences/generate-all')
    expect(opts?.method).toBe('POST')
  })

  it('createTaskFromOccurrence posts to the right path', async () => {
    await api.createTaskFromOccurrence(5)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/occurrences/5/task')
    expect(opts?.method).toBe('POST')
  })
})

// ── Credit card endpoints ──────────────────────────────────────────────────

describe('api — credit card endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse({})) })

  it('fetchCreditCardTracker calls GET /api/credit-cards/tracker', async () => {
    await api.fetchCreditCardTracker()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/credit-cards/tracker')
  })

  it('createCreditCard posts to /api/credit-cards', async () => {
    await api.createCreditCard({ name: 'Visa' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/credit-cards')
    expect(opts?.method).toBe('POST')
  })
})

// ── Sync auth endpoints ────────────────────────────────────────────────────

describe('api — sync endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse({})) })

  it('gcalAuthStatus calls GET /api/sync/auth/status', async () => {
    await api.gcalAuthStatus()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/sync/auth/status')
  })

  it('deleteAllGcalEvents sends DELETE to /api/sync/gcal', async () => {
    await api.deleteAllGcalEvents()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/sync/gcal')
    expect(opts?.method).toBe('DELETE')
  })

  it('wipeAllGcalEvents sends DELETE with confirm header', async () => {
    await api.wipeAllGcalEvents()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/sync/gcal/wipe-all')
    expect(opts?.method).toBe('DELETE')
    expect((opts?.headers as Record<string, string>)['X-Confirm-Delete']).toBe('yes')
  })
})

// ── Task endpoints ─────────────────────────────────────────────────────────

describe('api — task endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse({})) })

  it('fetchTasks calls GET /api/tasks with limit', async () => {
    await api.fetchTasks()
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('/api/tasks')
    expect(url).toContain('limit=1000')
  })

  it('fetchTasks merges extra params', async () => {
    await api.fetchTasks({ status: 'open' })
    expect(mockFetch.mock.calls[0][0]).toContain('status=open')
  })

  it('createTask posts to /api/tasks', async () => {
    await api.createTask({ name: 'Buy milk' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tasks')
    expect(opts?.method).toBe('POST')
  })

  it('updateTask patches the right path', async () => {
    await api.updateTask(11, { done: true })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tasks/11')
    expect(opts?.method).toBe('PATCH')
  })

  it('deleteTask deletes the right path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    await api.deleteTask(22)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tasks/22')
    expect(opts?.method).toBe('DELETE')
  })
})

// ── Subtask endpoints ──────────────────────────────────────────────────────

describe('api — subtask endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse({})) })

  it('createSubtask posts to /api/tasks/:id/subtasks', async () => {
    await api.createSubtask(5, { name: 'Sub' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tasks/5/subtasks')
    expect(opts?.method).toBe('POST')
  })

  it('updateSubtask patches the right path', async () => {
    await api.updateSubtask(5, 9, { done: true })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tasks/5/subtasks/9')
    expect(opts?.method).toBe('PATCH')
  })

  it('deleteSubtask deletes the right path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    await api.deleteSubtask(5, 9)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tasks/5/subtasks/9')
    expect(opts?.method).toBe('DELETE')
  })
})

// ── Person / Store endpoints ───────────────────────────────────────────────

describe('api — person and store endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse([])) })

  it('fetchPersons calls GET /api/persons', async () => {
    await api.fetchPersons()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/persons')
  })

  it('fetchStores calls GET /api/stores', async () => {
    await api.fetchStores()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/stores')
  })

  it('createStore posts to /api/stores', async () => {
    await api.createStore({ name: 'ALDI' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/stores')
    expect(opts?.method).toBe('POST')
  })

  it('updateStore patches the right path', async () => {
    await api.updateStore(3, { name: 'Costco' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/stores/3')
    expect(opts?.method).toBe('PATCH')
  })

  it('deleteStore deletes the right path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    await api.deleteStore(3)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/stores/3')
    expect(opts?.method).toBe('DELETE')
  })
})

// ── Grocery item (catalog) endpoints ──────────────────────────────────────

describe('api — grocery item endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse([])) })

  it('fetchGroceryItems calls /api/grocery/items without params', async () => {
    await api.fetchGroceryItems()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/grocery/items')
  })

  it('fetchGroceryItems appends query string when params given', async () => {
    await api.fetchGroceryItems({ store_id: '2' })
    expect(mockFetch.mock.calls[0][0]).toContain('/api/grocery/items?store_id=2')
  })

  it('createGroceryItem posts to /api/grocery/items', async () => {
    await api.createGroceryItem({ name: 'Milk' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/items')
    expect(opts?.method).toBe('POST')
  })

  it('updateGroceryItem patches the right path', async () => {
    await api.updateGroceryItem(8, { name: 'Oat Milk' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/items/8')
    expect(opts?.method).toBe('PATCH')
  })

  it('deleteGroceryItem deletes the right path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    await api.deleteGroceryItem(8)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/items/8')
    expect(opts?.method).toBe('DELETE')
  })
})

// ── On-hand endpoints ──────────────────────────────────────────────────────

describe('api — on-hand endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse([])) })

  it('fetchOnHand calls GET /api/grocery/on-hand', async () => {
    await api.fetchOnHand()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/grocery/on-hand')
  })

  it('upsertOnHand sends PUT to the right path', async () => {
    await api.upsertOnHand(4, { quantity: 2 })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/on-hand/4')
    expect(opts?.method).toBe('PUT')
  })

  it('deleteOnHand sends DELETE to the right path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    await api.deleteOnHand(4)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/on-hand/4')
    expect(opts?.method).toBe('DELETE')
  })
})

// ── Grocery list endpoints ─────────────────────────────────────────────────

describe('api — grocery list endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse([])) })

  it('fetchGroceryLists calls /api/grocery/lists without params', async () => {
    await api.fetchGroceryLists()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/grocery/lists')
  })

  it('fetchGroceryLists appends query string when params given', async () => {
    await api.fetchGroceryLists({ status: 'active' })
    expect(mockFetch.mock.calls[0][0]).toContain('status=active')
  })

  it('fetchGroceryList calls GET /api/grocery/lists/:id', async () => {
    mockFetch.mockResolvedValue(mockOkResponse({ id: 1 }))
    await api.fetchGroceryList(1)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/grocery/lists/1')
  })

  it('createGroceryList posts to /api/grocery/lists', async () => {
    await api.createGroceryList({ name: 'Weekly' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/lists')
    expect(opts?.method).toBe('POST')
  })

  it('updateGroceryList patches the right path', async () => {
    await api.updateGroceryList(1, { status: 'completed' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/lists/1')
    expect(opts?.method).toBe('PATCH')
  })

  it('deleteGroceryList deletes the right path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    await api.deleteGroceryList(1)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/lists/1')
    expect(opts?.method).toBe('DELETE')
  })
})

// ── Grocery list item endpoints ────────────────────────────────────────────

describe('api — grocery list item endpoints', () => {
  beforeEach(() => { mockFetch.mockResolvedValue(mockOkResponse({})) })

  it('addGroceryListItem posts to /api/grocery/lists/:id/items', async () => {
    await api.addGroceryListItem(1, { item_id: 5, quantity: '2', unit: 'each' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/lists/1/items')
    expect(opts?.method).toBe('POST')
  })

  it('updateGroceryListItem patches the right path', async () => {
    await api.updateGroceryListItem(1, 5, { status: 'purchased' })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/lists/1/items/5')
    expect(opts?.method).toBe('PATCH')
  })

  it('removeGroceryListItem deletes the right path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(null, 204))
    await api.removeGroceryListItem(1, 5)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/grocery/lists/1/items/5')
    expect(opts?.method).toBe('DELETE')
  })
})
