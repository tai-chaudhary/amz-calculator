/**
 * Goods in: what's coming, as the warehouse sees it. Only a delivery date
 * someone has confirmed with the supplier is ever shown — never an estimate.
 */
import { dayLabel } from './purchases.js'

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)
const fromYmd = (s) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null)
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

/** Lines with something still to come. */
export const toCome = (order) => (order.items || [])
  .filter(i => i.line_status !== 'cancelled' && num(i.qty_received) < num(i.qty))
  .map(i => ({ ...i, left: num(i.qty) - num(i.qty_received) }))

/** Has the supplier actually got it? Paid up front, it's only released once paid. */
export const isPlaced = (o) => !['draft', 'cancelled'].includes(o.status) && (o.terms === 'credit' || o.payment_status === 'paid')

export const GROUPS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Due today' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'later', label: 'Later' },
  { id: 'back_order', label: 'On back order' },
  { id: 'no_date', label: 'No delivery date yet' },
]

/** Where an order stands for the warehouse: which group, and what to say. */
export function arrivalOf(order, now = new Date()) {
  const lines = toCome(order)
  if (!lines.length) return { group: 'done', label: 'All in', tone: 'live' }
  const today = startOfDay(now)
  const placed = isPlaced(order)
  // Everything still to come is on back order: its own dates matter
  if (lines.every(l => l.line_status === 'back_order')) {
    const dates = lines.map(l => fromYmd(l.back_order_date))
    if (dates.some(d => !d)) return { group: 'back_order', label: 'Back order — date TBC', tone: 'paused' }
    const d = new Date(Math.min(...dates))
    return d < today ? { group: 'overdue', date: d, label: `Back order was due ${dayLabel(d)}`, tone: 'alert' }
      : { group: 'back_order', date: d, label: `Back order — ${dayLabel(d)}`, tone: 'paused' }
  }
  const d = fromYmd(order.delivery_date)
  if (!d) return { group: 'no_date', label: placed ? 'Ordered — no date yet' : 'Being ordered', tone: 'quiet' }
  const days = Math.round((startOfDay(d) - today) / 86400000)
  if (days < 0) return { group: 'overdue', date: d, label: `Was due ${dayLabel(d)}`, tone: 'alert' }
  if (days === 0) return { group: 'today', date: d, label: 'Due today', tone: 'live' }
  if (days <= 7) return { group: 'week', date: d, label: `Due ${dayLabel(d)}`, tone: 'brand' }
  return { group: 'later', date: d, label: `Due ${dayLabel(d)}`, tone: 'quiet' }
}

/** Open orders, grouped for the Expected list, soonest first. */
export function groupExpected(orders, now = new Date()) {
  const out = Object.fromEntries(GROUPS.map(g => [g.id, []]))
  for (const o of orders) {
    const a = arrivalOf(o, now)
    if (a.group !== 'done') out[a.group].push({ ...o, arrival: a })
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.arrival.date || 0) - (b.arrival.date || 0) || a.po_number.localeCompare(b.po_number))
  return out
}

/**
 * Turn what was entered on the receive screen into lines to book in.
 * entries: { [itemId]: { arrived, damaged, wrong, short, note, photo_path } }
 */
export function bookingLines(order, entries) {
  return toCome(order).map(i => {
    const e = entries[i.id] || {}
    const arrived = Math.max(0, num(e.arrived))
    const damaged = Math.min(Math.max(0, num(e.damaged)), arrived)
    const wrong = Math.max(0, num(e.wrong))
    const shortQty = Math.max(0, i.left - arrived)
    return {
      po_item_id: i.id, name: i.name, expected: i.left, arrived, damaged, wrong_qty: wrong,
      short: !!e.short && shortQty > 0, short_qty: e.short ? shortQty : 0,
      note: (e.note || '').trim() || null, photo_path: e.photo_path || null,
    }
  }).filter(l => l.arrived > 0 || l.damaged > 0 || l.wrong_qty > 0 || l.short || l.note || l.photo_path)
}

/** A delivery that needs the office: something wrong, or no order to match it to. */
export const needsOffice = (d) => d.office_status === 'open'

export const deliveryUnits = (d) => (d.lines || []).reduce((s, l) => s + num(l.arrived ?? l.qty), 0)
