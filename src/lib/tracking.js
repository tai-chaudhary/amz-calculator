/**
 * Delivery tracking: what HELM's couriers say happened to each parcel, and
 * which ones need someone to look.
 *
 * Parcels go Next Day, so a parcel is late once 2 working days have passed
 * since its label was booked (Sunday doesn't count) and it still hasn't been
 * delivered. Late parcels and returns hurt the account's health, so they come
 * first.
 */

export const STATUS = {
  1: 'Booked', 2: 'Collected', 3: 'At the depot', 4: 'In transit', 5: 'Out for delivery',
  6: 'Failed attempt', 7: 'Delivered', 8: 'On hold', 9: 'Address problem', 10: 'Returned to sender',
  11: 'Tracking expired', 12: 'Cancelled', 13: 'Waiting for collection', 14: 'Not tracked',
}
// Statuses that need someone to do something
export const PROBLEM = [6, 8, 9, 10, 11, 13]
const DONE = [7, 12, 14]

const LONDON = 'Europe/London'
// One formatter, and each timestamp worked out once: making a new formatter for every date was
// what made the page slow — thousands of parcels, several dates each, on a phone.
const LONDON_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: LONDON })
const dayCache = new Map()
const dayOf = (iso) => {
  if (typeof iso !== 'string') return LONDON_DAY.format(new Date(iso))
  const k = iso
  let d = dayCache.get(k)
  if (d === undefined) {
    d = LONDON_DAY.format(new Date(iso))
    if (dayCache.size > 20000) dayCache.clear()
    dayCache.set(k, d)
  }
  return d
}
const addDay = (ymd, n = 1) => {
  const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const isSunday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0

/** The last day a parcel booked at `shippedAt` can arrive and still count as on time (London date). */
export function dueDay(shippedAt, workingDays = 2) {
  if (!shippedAt) return null
  let d = dayOf(shippedAt), left = workingDays
  while (left > 0) { d = addDay(d); if (!isSunday(d)) left-- }
  return d
}

/** Working days (Sundays off) from the label being booked to `until` (default now). */
export function workingDaysSince(shippedAt, until = new Date()) {
  if (!shippedAt) return 0
  let d = dayOf(shippedAt), n = 0
  const end = dayOf(until)
  while (d < end) { d = addDay(d); if (!isSunday(d)) n++ }
  return n
}

/** What the carrier really is: Amazon's Buy Shipping is a way of buying labels, the courier is in the service name. */
export function carrierName(p) {
  const s = `${p?.service || ''} ${p?.carrier || ''}`
  if (/evri|hermes/i.test(s)) return 'Evri'
  if (/dhl/i.test(s)) return 'DHL'
  if (/royal ?mail|parcelforce/i.test(s)) return 'Royal Mail'
  if (/\bdpd\b/i.test(s)) return 'DPD'
  if (/\bups\b/i.test(s)) return 'UPS'
  if (/yodel/i.test(s)) return 'Yodel'
  return p?.carrier || 'Unknown'
}
export const viaAmazon = (p) => /^amazon/i.test(p?.carrier || '')

/**
 * Where one parcel stands.
 *   state: delivered | late | problem | stuck | moving | untracked | cancelled
 *   late: past its due day and not delivered (or delivered after it)
 */
const stateCache = new WeakMap()
export function parcelState(p, now = new Date()) {
  const key = dayOf(now)
  const hit = stateCache.get(p)
  if (hit && hit.key === key) return hit.s
  const s = workOutState(p, now)
  stateCache.set(p, { key, s })
  return s
}

function workOutState(p, now) {
  const due = dueDay(p.shipped_at)
  const today = dayOf(now)
  const status = p.status == null ? null : Number(p.status)
  const deliveredDay = p.delivered_at ? dayOf(p.delivered_at) : null
  const base = { due, status, label: STATUS[status] || 'No tracking yet', days: workingDaysSince(p.shipped_at, p.delivered_at || now) }
  if (status === 12) return { ...base, state: 'cancelled', late: false }
  if (status === 14 || status == null) return { ...base, state: 'untracked', late: false }
  if (status === 7) return { ...base, state: 'delivered', late: !!(due && deliveredDay && deliveredDay > due), returned: !!p.returned_at }
  const late = !!(due && today > due)
  if (PROBLEM.includes(status)) return { ...base, state: 'problem', late }
  // Booked, but the courier never scanned it once the day after it should have gone
  if (status === 1 && workingDaysSince(p.shipped_at, now) >= 1) return { ...base, state: 'stuck', late }
  return { ...base, state: late ? 'late' : 'moving', late }
}

/** Parcels that count: a booked label with a tracking number (failed and cancelled bookings left out). */
export const realParcel = (p) => p && (p.shipment_status == null || Number(p.shipment_status) === 1) && !!p.tracking

/** Open parcels someone should look at: late, a courier problem, or never scanned. */
export function needsAttention(p, now = new Date()) {
  if (!realParcel(p)) return false
  const s = parcelState(p, now)
  return s.state === 'problem' || s.state === 'stuck' || (s.state === 'late')
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)

/** Totals for a set of parcels, overall and per courier. */
export function summariseParcels(parcels, now = new Date()) {
  const rows = parcels.filter(realParcel).map(p => ({ p, s: parcelState(p, now), carrier: carrierName(p) }))
  const blank = () => ({ parcels: 0, tracked: 0, delivered: 0, onTime: 0, lateDelivered: 0, lateOpen: 0, problems: 0, returned: 0, stuck: 0, untracked: 0, moving: 0, hours: [] })
  const total = blank(), by = new Map()
  for (const { p, s, carrier } of rows) {
    if (!by.has(carrier)) by.set(carrier, { name: carrier, ...blank() })
    for (const t of [total, by.get(carrier)]) {
      t.parcels++
      if (s.state === 'untracked') { t.untracked++; continue }
      if (s.state === 'cancelled') continue
      t.tracked++
      if (s.state === 'delivered') {
        t.delivered++
        if (s.late) t.lateDelivered++; else t.onTime++
        if (p.shipped_at && p.delivered_at) t.hours.push((Date.parse(p.delivered_at) - Date.parse(p.shipped_at)) / 36e5)
      }
      if (s.state === 'late') t.lateOpen++
      if (s.state === 'problem') { t.problems++; if (s.late) t.lateOpen++ }
      if (s.state === 'stuck') { t.stuck++; if (s.late) t.lateOpen++ }
      if (s.state === 'moving') t.moving++
      if (p.returned_at || s.status === 10) t.returned++
    }
  }
  const finish = (t) => {
    const h = [...t.hours].sort((a, b) => a - b)
    // On time out of the parcels whose fate is known: delivered, or already late
    const decided = t.delivered + t.lateOpen
    return { ...t, hours: undefined, medianHours: h.length ? Math.round(h[Math.floor(h.length / 2)]) : null,
      onTimePct: pct(t.onTime, decided), deliveredPct: pct(t.delivered, t.tracked) }
  }
  return { total: finish(total), carriers: [...by.values()].map(finish).sort((a, b) => b.parcels - a.parcels) }
}

/**
 * Products that keep running into trouble: late, returned, failed attempts or
 * address/hold problems, per product, so packing can be looked at.
 */
export function productPatterns(parcels, now = new Date()) {
  const m = new Map()
  for (const p of parcels.filter(realParcel)) {
    const s = parcelState(p, now)
    if (s.state === 'untracked' || s.state === 'cancelled') continue
    const lines = Array.isArray(p.items) && p.items.length ? p.items : [{ code: '', name: 'Not known', qty: 0 }]
    for (const it of lines) {
      const k = it.code || it.name
      if (!m.has(k)) m.set(k, { key: k, code: it.code, name: it.name, parcels: 0, trouble: 0, late: 0, returned: 0, failed: 0, other: 0, carriers: new Map() })
      const r = m.get(k)
      r.parcels++
      if (s.late) r.late++
      const hist = p.event_codes || (p.events || []).map(e => Number(e.s))
      const returned = !!p.returned_at || s.status === 10 || hist.includes(10)
      if (returned) r.returned++
      const failed = !returned && (hist.includes(6) || s.status === 6)
      const other = !returned && !failed && (hist.some(x => [8, 9, 11, 13].includes(x)) || [8, 9, 11, 13].includes(s.status))
      if (s.late || returned || failed || other) {
        r.trouble++
        if (failed) r.failed++
        if (other) r.other++
        const c = carrierName(p); r.carriers.set(c, (r.carriers.get(c) || 0) + 1)
      }
    }
  }
  return [...m.values()]
    .map(r => ({ ...r, carriers: [...r.carriers.entries()].sort((a, b) => b[1] - a[1]) }))
    .map(r => ({ ...r, rate: pct(r.trouble, r.parcels) }))
    .filter(r => r.trouble > 0)
    .sort((a, b) => b.returned - a.returned || b.trouble - a.trouble || b.rate - a.rate)
}
