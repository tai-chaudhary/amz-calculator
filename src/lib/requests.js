/**
 * Stock requests: the warehouse asks, the office orders. Where a request is up
 * to is worked out from the order it's linked to, so nobody updates two places.
 * Nothing here knows or shows a price.
 */
import { dayLabel } from './purchases.js'

export const URGENCY = {
  out:         { label: 'Out of stock', short: 'Out', tone: 'alert', rank: 0 },
  running_low: { label: 'Running low', short: 'Low', tone: 'paused', rank: 1 },
  low:         { label: 'Not urgent', short: 'Not urgent', tone: 'quiet', rank: 2 },
}

/** The steps a request goes through, as the warehouse sees them. */
export const STEPS = ['Raised', 'Seen', 'Ordered', 'Date confirmed', 'Arrived']

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)
const fromYmd = (s) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null)
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

/** Has the supplier actually got the order? Paid up front, it's released once paid. */
const placed = (p) => p && !['draft', 'cancelled'].includes(p.po_status) &&
  (p.po_terms === 'credit' || p.payment_status === 'paid')

/**
 * Where a request is up to.
 *   open: still something to come   needsOffice: the office has to act
 *   step: index into STEPS for the progress bar
 */
export function requestState(req) {
  const p = req.progress
  if (req.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'quiet', open: false, step: -1 }
  if (req.status === 'declined') return { key: 'declined', label: 'Not being ordered', tone: 'quiet', open: false, step: -1 }
  if (!req.po_id || !p) {
    return req.status === 'acknowledged'
      ? { key: 'seen', label: 'Seen by the office', tone: 'brand', open: true, step: 1 }
      : { key: 'raised', label: 'Waiting for the office', tone: 'paused', open: true, step: 0, needsOffice: true }
  }
  const qty = num(p.qty)
  const got = num(p.qty_received)
  if (p.po_status === 'cancelled') return { key: 'po_cancelled', label: 'Order cancelled — office to re-order', tone: 'alert', open: true, step: 1, needsOffice: true }
  if (p.line_status === 'cancelled') return { key: 'line_cancelled', label: 'Supplier can’t supply — office looking elsewhere', tone: 'alert', open: true, step: 1, needsOffice: true }
  if (qty > 0 && got >= qty) return { key: 'arrived', label: 'Arrived', tone: 'live', open: false, step: 4 }
  if (!placed(p)) return { key: 'ordering', label: 'Being ordered', tone: 'brand', open: true, step: 1 }
  const part = got > 0 ? `${got} of ${qty} arrived · ` : ''
  if (p.line_status === 'back_order') {
    const d = fromYmd(p.back_order_date)
    if (!d) return { key: 'back_order', label: `${part}On back order — no date yet`, tone: 'paused', open: true, step: 2 }
    return d < today()
      ? { key: 'late', label: `${part}Back order was due ${dayLabel(d)} — office chasing`, tone: 'alert', open: true, step: 3 }
      : { key: 'back_order', label: `${part}On back order — due ${dayLabel(d)}`, tone: 'paused', open: true, step: 3 }
  }
  if (p.delivery_date) {
    const d = fromYmd(p.delivery_date)
    return d < today()
      ? { key: 'late', label: `${part}Was due ${dayLabel(d)} — office chasing`, tone: 'alert', open: true, step: 3 }
      : { key: 'arriving', label: `${part}Arriving ${dayLabel(d)}`, tone: 'live', open: true, step: 3 }
  }
  return { key: 'ordered', label: `${part}Ordered — awaiting a delivery date`, tone: 'brand', open: true, step: 2 }
}

/** An open request for the same thing, so it isn't asked for twice. */
export function openRequestFor(requests, { stockItemId, name }) {
  const n = String(name || '').trim().toLowerCase()
  return requests.find(r => requestState(r).open &&
    ((stockItemId && r.stock_item_id === stockItemId) || (!stockItemId && n && !r.stock_item_id && r.product_name.trim().toLowerCase() === n))) || null
}

/** Most pressing first: things the office must act on, then by urgency, then oldest. */
export function sortRequests(list) {
  return list.slice().sort((a, b) => {
    const sa = requestState(a), sb = requestState(b)
    return (sb.open - sa.open) || ((sb.needsOffice ? 1 : 0) - (sa.needsOffice ? 1 : 0)) ||
      ((URGENCY[a.urgency]?.rank ?? 1) - (URGENCY[b.urgency]?.rank ?? 1)) ||
      (new Date(a.created_at) - new Date(b.created_at))
  })
}

/** "2 days ago", "just now" */
export function ago(at) {
  if (!at) return ''
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`
  const days = Math.round(hrs / 24)
  if (days < 14) return `${days} day${days !== 1 ? 's' : ''} ago`
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
