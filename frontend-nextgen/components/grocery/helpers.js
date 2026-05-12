export const GROCERY_UNITS = [
  'each', 'lb', 'oz', 'fl_oz', 'g', 'kg', 'liter', 'ml',
  'bunch', 'bag', 'box', 'can', 'jar', 'pack',
]

export const LIST_STATUS_LABEL = {
  draft:     'Draft',
  active:    'Active',
  completed: 'Completed',
}

export const LIST_STATUS_CLS = {
  draft:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  active:    'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
}

export const NEXT_STATUS = { draft: 'active', active: 'completed' }
export const NEXT_STATUS_LABEL = { draft: 'Start Shopping', active: 'Mark Completed' }

export function fmtQty(qty, unit) {
  const n = parseFloat(qty)
  return unit === 'each' ? `× ${n % 1 === 0 ? n : n}` : `${n} ${unit}`
}

export function fmtPrice(price) {
  if (price == null) return ''
  return `$${parseFloat(price).toFixed(2)}`
}

export function listSummary(items) {
  const total = items.length
  const done  = items.filter(i => i.status === 'purchased').length
  return { total, done }
}
