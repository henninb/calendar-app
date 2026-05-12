export type GroceryUnit =
  | 'each' | 'lb' | 'oz' | 'fl_oz' | 'g' | 'kg' | 'liter' | 'ml'
  | 'bunch' | 'bag' | 'box' | 'can' | 'jar' | 'pack'

export type ListStatus = 'draft' | 'active' | 'completed'

export interface GroceryItem {
  id: number
  name: string
  qty: number | string
  unit: GroceryUnit
  status: string
  price?: number | null
  store_id?: number | null
  notes?: string
}

export interface Store {
  id: number
  name: string
  location?: string | null
}

export interface CatalogItem {
  id: number
  name: string
  default_unit: GroceryUnit
  default_store_id?: number | null
  default_store?: { name: string } | null
}

export interface OnHandRecord {
  item_id: number
  quantity: string | number
  unit: GroceryUnit
}

export interface ListItem {
  id: number
  item_id: number
  item: { name: string }
  quantity: string | number
  unit: GroceryUnit
  price?: string | number | null
  status: 'needed' | 'purchased'
}

export interface GroceryList {
  id: number
  name: string
  status: ListStatus
  store_id?: number | null
  store?: Store | null
  shopping_date?: string | null
  items: ListItem[]
}

export interface ListSummary {
  total: number
  done: number
}

export const GROCERY_UNITS: GroceryUnit[] = [
  'each', 'lb', 'oz', 'fl_oz', 'g', 'kg', 'liter', 'ml',
  'bunch', 'bag', 'box', 'can', 'jar', 'pack',
]

export const LIST_STATUS_LABEL: Record<ListStatus, string> = {
  draft:     'Draft',
  active:    'Active',
  completed: 'Completed',
}

export const LIST_STATUS_CLS: Record<ListStatus, string> = {
  draft:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  active:    'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
}

export const NEXT_STATUS: Partial<Record<ListStatus, ListStatus>> = { draft: 'active', active: 'completed' }
export const NEXT_STATUS_LABEL: Partial<Record<ListStatus, string>> = { draft: 'Start Shopping', active: 'Mark Completed' }

export function fmtQty(qty: number | string, unit: GroceryUnit): string {
  const n = parseFloat(String(qty))
  return unit === 'each' ? `× ${n % 1 === 0 ? n : n}` : `${n} ${unit}`
}

export function fmtPrice(price: number | null | undefined): string {
  if (price == null) return ''
  return `$${parseFloat(String(price)).toFixed(2)}`
}

export function listSummary(items: Array<{ status: string }>): ListSummary {
  const total = items.length
  const done  = items.filter(i => i.status === 'purchased').length
  return { total, done }
}
