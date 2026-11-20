/**
 * Cases & Refunds, v2.106.0 (the owner's brief of 19 Nov 2026): "actions taken" on a case, "held at depot since",
 * and replacement requests — the twin of refund requests.
 *
 * A replacement request: the office asks (what to send, how many, why) → an admin approves or declines → the admin
 * uploads the replacement's label on the request. That upload is an ordinary Dispatch batch marked as a replacement
 * for the order (the same path as Order Audit's "Arrange a replacement"), stamped with the products asked for. What
 * became of the label — printed, dispatched, delivered — is read back from Dispatch, never typed in.
 */
export const CASE_ACTIONS = {
  responded: 'Responded to buyer',
  awaiting_buyer: 'Awaiting buyer response',
  offered: 'Offered refund or replacement',
}

/** Tick or untick an action: returns { actions, what } — the new list (in the fixed order) and the history line */
export function toggleAction(actions, key) {
  const had = (actions || []).includes(key)
  const set = new Set(actions || [])
  if (had) set.delete(key); else set.add(key)
  return { actions: Object.keys(CASE_ACTIONS).filter(k => set.has(k)), what: `${had ? 'Removed' : 'Action taken'}: ${CASE_ACTIONS[key] || key}`, added: !had }
}

/** Whole days a parcel has been held at the depot, counting from `since` (YYYY-MM-DD) to `today`; null when not known */
export function daysHeld(since, today) {
  if (!since || !today) return null
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86400000)
  return Number.isFinite(d) && d >= 0 ? d : null
}

export const REPLACEMENT_STAGES = {
  requested: { label: 'Waiting for approval', tone: 'warn' },
  declined: { label: 'Declined', tone: 'quiet' },
  approved: { label: 'Approved — label needed', tone: 'info' },
  uploaded: { label: 'Label uploaded — to dispatch', tone: 'info' },
  dispatched: { label: 'Dispatched', tone: 'live' },
  delivered: { label: 'Delivered', tone: 'live' },
}

/**
 * Where a replacement request has got to. `labels` are its Dispatch labels (care_replacement_labels), cancelled ones
 * already left out. Several parcels: it is dispatched (or delivered) only when every one of them is.
 */
export function replacementStage(req, labels = []) {
  if (!req) return 'requested'
  if (req.status === 'requested' || req.status === 'declined') return req.status
  const mine = (labels || []).filter(l => l.request_id === req.id)
  if (!mine.length) return req.upload_id || req.label_uploaded_at ? 'uploaded' : 'approved'
  if (mine.every(l => l.delivered_at)) return 'delivered'
  if (mine.every(l => l.status === 'dispatched' || l.dispatched_at)) return 'dispatched'
  return 'uploaded'
}

/** Requests that still need someone: waiting for approval, approved with no label, or a label not yet dispatched */
export const replacementOpen = (req, labels) => ['requested', 'approved', 'uploaded'].includes(replacementStage(req, labels))

/** "2 × Pyrex Jug 1L, Brown Salt 25kg" */
export const sendText = (items = []) => items.map(i => `${Number(i.qty) > 1 ? `${i.qty} × ` : ''}${i.name || i.code}`).join(', ')

/** What stops a request being sent, or null */
export function replacementProblem({ order, items, why }) {
  if (!order) return 'Find the order first'
  if (!(items || []).length) return 'Tick what to send'
  if ((items || []).some(i => !(Number(i.qty) >= 1))) return 'Give a quantity for each product'
  if (!String(why || '').trim()) return 'Say why it is needed'
  return null
}

/**
 * Which Dispatch day a replacement label uploaded from Cases & Refunds belongs to (the owner, 19 Nov 2026): uploaded
 * from 5:00pm it goes to the NEXT working day; working days are Monday to Saturday. So 5:30pm on a Wednesday →
 * Thursday; 5:30pm on a Saturday → Monday; any time on a Sunday → Monday. Before 5pm on a working day → today.
 * London time. Returns { date: 'YYYY-MM-DD', moved: true when it is not today, today }.
 */
export const REPLACEMENT_CUTOFF_HOUR = 17
export function replacementShipDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(now).map(p => [p.type, p.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const late = Number(parts.hour) >= REPLACEMENT_CUTOFF_HOUR, sunday = parts.weekday === 'Sun'
  if (!late && !sunday) return { date: today, moved: false, today }
  const d = new Date(`${today}T12:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0)      // Monday to Saturday: after Saturday it is Monday
  return { date: d.toISOString().slice(0, 10), moved: true, today }
}
