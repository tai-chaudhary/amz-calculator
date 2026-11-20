/**
 * Overheads (v2.82.0; frequency in v2.82.1): fixed costs, each counted from the date it starts.
 *
 * The owner's rules:
 *  - fixed costs only (one-offs and other running costs are handled elsewhere, still to be decided);
 *  - each is paid weekly, monthly, quarterly or yearly, and whatever the frequency it is counted BY DAYS:
 *    weekly ÷ 7; monthly ÷ the days in that month; quarterly ÷ the days in that calendar quarter; yearly ÷ the days
 *    in that year — so a whole month / quarter / year always comes to exactly the amount entered;
 *  - a change of amount is added with the date it applies from — earlier days keep the old amount;
 *  - amounts are ex VAT.
 *
 * The figures the portal shows come from the database (overheads_daily in migration 105). The functions here mirror
 * that sum so the forms can show what a date or an amount will do BEFORE it is saved. Keep the two in step.
 */
export const OVERHEAD_CATEGORIES = [
  { id: 'staff', label: 'Staff & Payroll', icon: 'user' },
  { id: 'software', label: 'Software & Subscriptions', icon: 'settings' },
  { id: 'office', label: 'Office & Premises', icon: 'briefcase' },
  { id: 'marketing', label: 'Marketing & Advertising', icon: 'trend' },
  { id: 'professional', label: 'Professional Services', icon: 'review' },
  { id: 'other', label: 'Other', icon: 'list' },
]
export const categoryLabel = (id) => OVERHEAD_CATEGORIES.find(c => c.id === id)?.label || 'Other'

// Dates are 'YYYY-MM-DD' strings throughout; day numbers keep the sums free of time zones.
const dayNo = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000) }
const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10)
export const daysInMonth = (iso) => { const [y, m] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
export const monthStart = (iso) => `${String(iso).slice(0, 7)}-01`
export const monthEnd = (iso) => `${String(iso).slice(0, 7)}-${String(daysInMonth(iso)).padStart(2, '0')}`
export const addMonths = (iso, n) => { const [y, m] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10) }
export const monthLabel = (iso) => new Date(`${monthStart(iso)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export const FREQUENCIES = [
  { id: 'week', label: 'Weekly', word: 'a week' },
  { id: 'month', label: 'Monthly', word: 'a month' },
  { id: 'quarter', label: 'Quarterly', word: 'a quarter' },
  { id: 'year', label: 'Yearly', word: 'a year' },
]
export const everyWord = (id) => FREQUENCIES.find(f => f.id === id)?.word || 'a month'

const daysInQuarter = (iso) => { const [y, m] = String(iso).split('-').map(Number); const q = Math.floor((m - 1) / 3) * 3; return Math.round((Date.UTC(y, q + 3, 1) - Date.UTC(y, q, 1)) / 86400000) }
const daysInYear = (iso) => { const y = Number(String(iso).slice(0, 4)); return Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000) }

/** What one day costs for an amount paid at a frequency. */
export function dayCost(amount, every, day) {
  const a = Number(amount) || 0
  return a / (every === 'week' ? 7 : every === 'quarter' ? daysInQuarter(day) : every === 'year' ? daysInYear(day) : daysInMonth(day))
}
/** The same amount as an average month (a year ÷ 12) — for "running now" totals and Build a Month. */
export function monthlyEquivalent(amount, every) {
  const a = Number(amount) || 0
  return Math.round((every === 'week' ? a * 52 / 12 : every === 'quarter' ? a / 3 : every === 'year' ? a / 12 : a) * 100) / 100
}

/** The amount in force on a day: the latest one on or before it; before the first, the first. → { amount, every } */
export function amountOn(amounts = [], day) {
  const list = [...amounts].sort((a, b) => String(a.from_date).localeCompare(String(b.from_date)))
  if (!list.length) return { amount: 0, every: 'month' }
  let hit = list[0]
  for (const a of list) if (String(a.from_date) <= day) hit = a
  return { amount: Number(hit.amount ?? hit.monthly) || 0, every: hit.every || 'month' }
}

/**
 * What one overhead costs between two dates (both included), by days.
 * item: { start_date, end_date?, amounts: [{ from_date, amount, every }] }  →  { cost, days }
 */
export function costBetween(item, from, to) {
  if (!item?.start_date || !from || !to) return { cost: 0, days: 0 }
  const lo = Math.max(dayNo(from), dayNo(item.start_date))
  const hi = Math.min(dayNo(to), item.end_date ? dayNo(item.end_date) : dayNo(to))
  let cost = 0
  for (let n = lo; n <= hi; n++) { const d = isoOf(n); const a = amountOn(item.amounts, d); cost += dayCost(a.amount, a.every, d) }
  return { cost: Math.round(cost * 100) / 100, days: Math.max(0, hi - lo + 1) }
}

/** "17 of 31 days" for a part month, '' for a whole one or none at all. */
export function partMonthNote(days, iso) {
  const all = daysInMonth(iso)
  return days > 0 && days < all ? `${days} of ${all} days` : ''
}

/** The list Build a Month starts a new month from: what is running today, each as an average month. */
export function runningForPlan(items = []) {
  return items.filter(i => i.status === 'running').map(i => ({ id: i.id, name: i.name, amount: Number(i.monthly_now) || 0, categoryId: i.category }))
}


// ── Fulfilment share (v2.100.0, migration 127) ───────────────────────────────────────────────────────────────────────
// How much of an overhead exists only because orders are stored, picked, packed and sent in-house (warehouse rent,
// warehouse staff, HELM…): 0 = none of it, 100 = all of it, anything between for someone who does both. The P&L's
// Fulfilment cost = shipping + packaging + this share of the overheads. It regroups costs; it changes no profit figure.
// v2.101.0 (migration 128): the share is DATED, like the amounts — each one applies from its date until the next, so
// earlier periods keep what they were. The owner's rule: wherever a cost is involved, a change carries its date.
// `fulfilment_share` on an item is the share in force today; `fulfilment_shares` are the dated ones, newest first.
export const fulfilmentShare = (i) => Math.min(100, Math.max(0, Number(i?.fulfilment_share) || 0))
export const fulfilmentWord = (share) => { const s = Math.min(100, Math.max(0, Number(share) || 0)); return s <= 0 ? 'Not counted' : s >= 100 ? 'All of it' : `${+s.toFixed(2)}% of it` }

/** The share in force on a day: the latest dated one on or before it; none yet = 0. The same rule as the database. */
export function shareOn(shares = [], day) {
  const hit = [...(shares || [])].filter(f => f.from_date <= day).sort((a, b) => b.from_date.localeCompare(a.from_date) || String(b.at || '').localeCompare(String(a.at || '')))[0]
  return hit ? Math.min(100, Math.max(0, Number(hit.share) || 0)) : 0
}
