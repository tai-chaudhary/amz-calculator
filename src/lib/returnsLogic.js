/**
 * Returns (v2.111.0): the rules behind the Returns page, kept here so they are tested (tests/returns.test.mjs).
 *
 *   classifyCode   what a scanned or typed code is (Evri return label, Royal Mail, RMA, Amazon order…), with warnings
 *   REASONS/CAUSE  the portal's return reasons (Amazon's codes map to them in the database) and who it comes down to
 *   OUTCOMES       what the warehouse can say about each item in the box
 *   buildTodo      the office's list (Jignesh), most urgent first
 *   summarise      the dashboards' figures for a period
 *
 * The owner's decisions (19 Nov 2026): self-post returns are expected but "not coming back" after 21 days; a prepaid
 * return is overdue after 14 days; nothing is held — photos at logging are the evidence for any claim; SAFE-T is filed
 * mainly by Jignesh.
 */

export const LOGGING_START = '2026-10-28'        // the warehouse began logging returns in the portal
export const OVERDUE_DAYS = 14                   // prepaid label, not arrived
export const NOT_COMING_DAYS = 21                // self-post, treated as not coming back
export const SAFET_DAYS = 30                     // file SAFE-T within this many days of the return arriving (check Seller Central)
export const RATE_ALERT = 3                      // % of units returned that flags a product (or double its own average)

// ── What was scanned ─────────────────────────────────────────────────────────────────────────────────────────────────
const PATTERNS = [
  { kind: 'rma', re: /\bD[0-9A-Za-z]{7}RRMA\b/, label: 'Amazon return (RMA)' },
  { kind: 'amazon_order', re: /\b\d{3}-\d{7}-\d{7}\b/, label: 'Amazon order number' },
  { kind: 'evri_barcode', re: /\bH-?\d{2}[A-Z]{2}-?[A-Z]-?\d{9,11}(-?\d)?\b/i, label: 'Evri shop label' },   // H01FFA… / H04FUA…: Evri's parcel number, printed at an Evri shop; never in Amazon's report
  { kind: 'evri', re: /\b[TCH]\d{2}[A-Z]{2}[A-Z0-9]{9,12}\b/i, label: 'Evri tracking' },
  { kind: 'royal_mail', re: /\b[A-Z]{2}\d{9}GB\b/i, label: 'Royal Mail tracking' },
  { kind: 'dhl', re: /\b(JD\d{16,18}|\d{9,10})\b/, label: 'DHL tracking' },
]
const key = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Turn a scan or what was typed into { kind, value, label, warn }. A camera scan of a 2D Royal Mail code can carry a
 * long string; the tracking number inside it is picked out. `warn` is a sentence for the warehouse when the code is
 * the wrong one to scan (Evri's own parcel barcode) or looks mistyped.
 */
export function classifyCode(raw) {
  const text = String(raw || '').trim()
  if (!text) return { kind: 'empty', value: '', label: '', warn: null }
  for (const p of PATTERNS) {
    const m = text.match(p.re)
    if (!m) continue
    let value = p.kind === 'amazon_order' ? m[0] : p.kind === 'rma' ? m[0] : key(m[0])
    let warn = null
    if (p.kind === 'evri' && /^T00W/.test(value) && value.length !== 16) warn = `Evri return numbers are 16 characters (T00WLA and 10 digits) — this has ${value.length}. Check it.`
    if (p.kind === 'dhl' && value.length === 9 && /^\d+$/.test(value)) value = m[0]
    return { kind: p.kind, value, label: p.label, warn }
  }
  const k = key(text)
  return { kind: 'other', value: k, label: 'Other code', warn: k.length < 8 ? 'This looks too short to be a tracking number. Check it.' : null }
}

// ── Reasons and causes ───────────────────────────────────────────────────────────────────────────────────────────────
export const REASONS = {
  to_check: 'Not known yet — office to fill in',
  returned_to_sender: 'Undeliverable (carrier returned it)', refused: 'Refused by the customer',
  damaged: 'Damaged in transit', damaged_packing: 'Damaged — packing', wrong_item: 'Wrong item sent',
  missing_parts: 'Parts missing', switcheroo: 'Different item sent back', faulty: 'Faulty', not_happy: 'Quality not acceptable',
  not_compatible: 'Not compatible / not as expected', bad_description: 'Not as described', late: 'Arrived too late',
  changed_mind: 'No longer wanted', ordered_wrong: 'Ordered by mistake', better_price: 'Found a better price',
  no_reason: 'No reason given', unauthorised: 'Unauthorised purchase', other: 'Other',
}
// Who it comes down to — the dashboard's first breakdown
export const CAUSE_OF = {
  damaged_packing: 'packing', wrong_item: 'packing', missing_parts: 'packing',
  damaged: 'carrier', late: 'carrier', returned_to_sender: 'carrier',
  changed_mind: 'customer', ordered_wrong: 'customer', better_price: 'customer', no_reason: 'customer', unauthorised: 'customer', refused: 'customer', switcheroo: 'customer',
  faulty: 'product', not_happy: 'product',
  bad_description: 'listing', not_compatible: 'listing',
}
export const CAUSES = {
  packing: { label: 'Packing', hint: 'damaged before it left, wrong or missing item', tone: 'red' },
  carrier: { label: 'Carrier', hint: 'damaged in transit, late, undeliverable', tone: 'amber' },
  customer: { label: 'Customer', hint: 'unwanted, ordered by mistake, different item sent back', tone: 'grey' },
  product: { label: 'Product', hint: 'faulty, quality', tone: 'red' },
  listing: { label: 'Listing', hint: 'not as described, not compatible', tone: 'blue' },
  unknown: { label: 'Not known', hint: 'reason not filled in', tone: 'grey' },
}
export const causeOf = (reason) => CAUSE_OF[reason] || 'unknown'

// ── What the warehouse says about each item (no holding: photos are the evidence) ───────────────────────────────────
export const OUTCOMES = {
  back_in_stock: { label: 'Fine — back in stock', short: 'Back in stock', tone: 'green', stock: true },
  disposed: { label: 'Damaged — dispose', short: 'Damaged, disposed', tone: 'red', photos: true, claim: true },
  faulty: { label: 'Faulty', short: 'Faulty', tone: 'red', photos: true, claim: true },
  wrong_item: { label: 'Wrong item sent back', short: 'Not our item', tone: 'red', photos: true, claim: true },
  empty: { label: 'Empty box / items missing', short: 'Empty or short', tone: 'red', photos: true, claim: true },
}
export const needsPhotos = (items = []) => items.some(i => OUTCOMES[i.outcome]?.photos)
/** The return's status from its items' outcomes (status values the rest of the portal already knows) */
export function statusFromItems(items = []) {
  const back = items.filter(i => i.outcome === 'back_in_stock').length, gone = items.length - back
  return !items.length ? 'received' : !gone ? 'restocked' : !back ? 'written_off' : 'processed'
}

// ── Dates ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const day = (iso) => (iso ? String(iso).slice(0, 10) : null)
/** DD-MM-YYYY, the portal's way of writing a date */
export const dmy = (iso) => { const d = day(iso); return d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '' }
export const daysBetween = (a, b) => Math.round((new Date(`${day(b)}T12:00:00Z`) - new Date(`${day(a)}T12:00:00Z`)) / 86400000)

/**
 * Where an Amazon request stands for us. Not logged yet: 'on_way' (prepaid, on its way), 'overdue' (prepaid, over 14
 * days), 'delivered' (Amazon says it reached us, nobody logged it), 'may_come' (self-post), 'not_coming' (self-post,
 * over 21 days), 'before' (arrived before the portal logged returns). Logged: 'logged'.
 */
export function amazonState(a, today) {
  if (a.return_id) return 'logged'
  if (a.delivered_at && day(a.delivered_at) < LOGGING_START) return 'before'
  if (a.delivered_at) return 'delivered'
  const age = daysBetween(a.request_date, today)
  if (a.self_post) return age > NOT_COMING_DAYS ? 'not_coming' : 'may_come'
  if (day(a.request_date) < '2026-10-14') return 'before'
  return age > OVERDUE_DAYS ? 'overdue' : 'on_way'
}
export const AMAZON_STATE = {
  on_way: { label: 'On its way', tone: 'blue' }, overdue: { label: 'Overdue', tone: 'red' },
  delivered: { label: 'Amazon says delivered — not logged', tone: 'red' }, may_come: { label: 'Customer posts it — may come back', tone: 'grey' },
  not_coming: { label: 'Not coming back', tone: 'grey' }, before: { label: 'Before returns were logged', tone: 'grey' }, logged: { label: 'Logged', tone: 'green' },
}

/** Can a SAFE-T claim be made for this logged return? Amazon return, and something not resaleable came back (or the customer's reason says so). */
export function safetEligible(r, amazon) {
  if (!r || !(r.rma || amazon)) return false
  const bad = (r.items || []).some(i => OUTCOMES[i.outcome]?.claim)
  const code = (amazon?.reason_code || r.amazon_reason || '').toUpperCase()
  return bad || /SWITCHEROO|MISSING_PARTS/.test(code)
}

// ── The office's list ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Everything someone in the office should do about returns, most urgent first. Each item:
 * { id, kind, rank, title, sub, tone, ref (a return or an RMA), due? }.
 */
export function buildTodo({ returns = [], amazon = [], claims = [], today }) {
  const out = []
  const amazonByRma = new Map(amazon.map(a => [a.rma, a]))
  const safetFor = new Set(claims.filter(c => c.kind === 'safet').flatMap(c => [c.return_id, c.rma]).filter(Boolean))
  const carrierFor = new Set(claims.filter(c => c.kind !== 'safet').map(c => c.order_ref).filter(Boolean))
  for (const r of returns) {
    if (r.status === 'expected' || r.status === 'closed') continue
    const a = r.rma ? amazonByRma.get(r.rma) : null
    // 1. SAFE-T to file, with the deadline counting down
    if (safetEligible(r, a) && !safetFor.has(r.id) && !(r.rma && safetFor.has(r.rma)) && !a?.safet_claim_id) {
      const since = r.received_at || r.created_at
      const left = SAFET_DAYS - daysBetween(since, today)
      if (left >= 0) out.push({ id: `safet-${r.id}`, kind: 'safet', rank: 1, tone: left <= 5 ? 'red' : 'amber', ref: r.id, due: left,
        title: `File SAFE-T for ${r.ref}`, sub: `${left} day${left === 1 ? '' : 's'} left · ${r.order_ref || ''}${a ? ` · ${REASONS[a.reason] || a.reason}` : ''}` })
    }
    // 6. Not matched to an order
    if (r.needs_match) out.push({ id: `match-${r.id}`, kind: 'match', rank: 6, tone: 'amber', ref: r.id, title: `Find the order for ${r.ref}`, sub: 'No exact match — see the suggested orders' })
    // 8. Carrier damaged it or couldn't deliver: a carrier claim
    if (r.order_ref && ['damaged', 'returned_to_sender'].includes(r.reason) && !carrierFor.has(r.order_ref) && r.source !== 'customer')
      out.push({ id: `claim-${r.id}`, kind: 'carrier_claim', rank: 8, tone: 'amber', ref: r.id, title: `Raise a carrier claim for ${r.ref}`, sub: `${REASONS[r.reason]} · ${r.order_ref}` })
    // 3. Arrived but Amazon has no request for it (another channel, a carrier return, or something odd)
    if (!r.needs_match && !r.rma && r.order_ref && /^\d{3}-\d{7}-\d{7}$/.test(r.order_ref) && r.source === 'customer' && r.received_at && day(r.received_at) >= LOGGING_START)
      out.push({ id: `noreq-${r.id}`, kind: 'no_request', rank: 3, tone: 'amber', ref: r.id, title: `${r.ref} arrived with no Amazon return request`, sub: `Order ${r.order_ref} — check why it came back` })
  }
  for (const a of amazon) {
    const st = amazonState(a, today)
    if (a.safet_state === 'PENDING_ACTION') out.push({ id: `safet-pending-${a.rma}`, kind: 'safet_action', rank: 2, tone: 'red', ref: a.rma, title: `SAFE-T waiting on us — ${a.order_ref}`, sub: `Claim ${a.safet_claim_id || ''} · reply in Seller Central` })
    if (st === 'delivered') out.push({ id: `notlogged-${a.rma}`, kind: 'not_logged', rank: 4, tone: 'red', ref: a.rma, title: `Amazon says ${a.order_ref} was delivered back — not logged`, sub: `${dmy(a.delivered_at)} · ${a.item_name || a.sku || ''}` })
    if (st === 'overdue') out.push({ id: `overdue-${a.rma}`, kind: 'overdue', rank: 5, tone: 'amber', ref: a.rma, title: `Overdue return — ${a.order_ref}`, sub: `Requested ${dmy(a.request_date)} · ${daysBetween(a.request_date, today)} days · ${a.carrier === 'HERMES_UK' ? 'Evri' : a.carrier === 'ROYAL_MAIL' ? 'Royal Mail' : a.carrier || ''} ${a.tracking || ''}` })
  }
  return out.sort((x, y) => x.rank - y.rank || (x.due ?? 99) - (y.due ?? 99))
}

// ── The dashboards ───────────────────────────────────────────────────────────────────────────────────────────────────
const inRange = (iso, from, to) => { const d = day(iso); return d && d >= from && d <= to }
const qtyOf = (items = []) => items.reduce((t, i) => t + (Number(i.qty) || 0), 0)

/**
 * The figures for from..to. `amazon` are the report's requests (by request date), `returns` the boxes logged (by the day
 * they arrived), `sold` = { [product_id]: units sold in the period } for return rates, `names` product id → name.
 * Money figures are what Amazon reports (refunds, labels, SAFE-T) and are only shown to people who see costs.
 */
export function summarise({ returns = [], amazon = [], sold = {}, names = {}, claims = [], today }, from, to) {
  const req = amazon.filter(a => inRange(a.request_date, from, to))
  const got = returns.filter(r => r.status !== 'expected' && inRange(r.received_at || r.created_at, from, to))
  const t = {
    requests: req.length, requestUnits: req.reduce((s, a) => s + (Number(a.qty) || 0), 0),
    arrived: got.length, arrivedUnits: got.reduce((s, r) => s + qtyOf(r.items), 0),
    stillExpected: req.filter(a => ['on_way', 'overdue', 'may_come', 'delivered'].includes(amazonState(a, today))).length,
    notComing: req.filter(a => amazonState(a, today) === 'not_coming').length,
    overdue: req.filter(a => amazonState(a, today) === 'overdue').length,
    notLogged: req.filter(a => amazonState(a, today) === 'delivered').length,
    selfPost: req.filter(a => a.self_post).length,
    refunded: req.reduce((s, a) => s + (Number(a.refund_amount) || 0), 0),
    orderValue: req.reduce((s, a) => s + (Number(a.order_amount) || 0), 0),
    labels: req.filter(a => a.label_paid_by === 'Seller').reduce((s, a) => s + (Number(a.label_cost) || 0), 0),
    safetGranted: amazon.filter(a => a.safet_state === 'GRANT' && inRange(a.safet_created_at || a.request_date, from, to)).reduce((s, a) => s + (Number(a.safet_amount) || 0), 0),
    safetCount: { granted: 0, refused: 0, pending: 0, filed: 0 },
    outcomes: {}, causes: {}, reasons: {}, products: [], packers: {}, carriers: {}, channels: {},
    matchedAuto: got.filter(r => ['rma', 'tracking', 'order'].includes(r.match_how) || (r.matched_by || '').includes('report') || r.matched_by === 'Matched by tracking number').length,
    unmatched: got.filter(r => r.needs_match).length,
  }
  for (const a of amazon) if (inRange(a.safet_created_at || a.request_date, from, to) && a.safet_claim_id) {
    t.safetCount.filed++
    if (a.safet_state === 'GRANT') t.safetCount.granted++; else if (a.safet_state === 'NOGRANT') t.safetCount.refused++; else t.safetCount.pending++
  }
  for (const c of claims) if (c.kind === 'safet' && !c.safet_claim_id && inRange(c.created_at, from, to)) { t.safetCount.filed++; t.safetCount.pending++ }
  for (const r of got) for (const i of r.items || []) if (i.outcome) t.outcomes[i.outcome] = (t.outcomes[i.outcome] || 0) + (Number(i.qty) || 1)
  // Reasons and causes: Amazon's requests, plus boxes that came with no request (carrier returns, other channels)
  const reasonRows = [...req.map(a => ({ reason: a.reason, qty: Number(a.qty) || 1, channel: 'Amazon', carrier: a.carrier })),
    ...got.filter(r => !r.rma).map(r => ({ reason: r.reason, qty: qtyOf(r.items) || 1, channel: r.channel || 'Not known', carrier: r.delivered_by || r.carrier }))]
  for (const x of reasonRows) {
    t.reasons[x.reason || 'to_check'] = (t.reasons[x.reason || 'to_check'] || 0) + 1
    const c = causeOf(x.reason); t.causes[c] = (t.causes[c] || 0) + 1
    t.channels[x.channel] = (t.channels[x.channel] || 0) + 1
  }
  for (const r of got) { const c = r.delivered_by || (r.carrier ? String(r.carrier).split(' ')[0] : null) || 'Not known'; t.carriers[c] = (t.carriers[c] || 0) + 1 }
  // Packing-cause returns against who packed the order (from the case / label where known)
  for (const r of got) if (causeOf(r.reason) === 'packing' && r.packer) t.packers[r.packer] = (t.packers[r.packer] || 0) + 1
  // Products: units asked back (Amazon) + units in boxes with no request; return rate against units sold
  const prod = new Map()
  const add = (i, n, reason) => {
    const k = i.product_id || `code:${i.code || i.name}`
    const p = prod.get(k) || prod.set(k, { key: k, product_id: i.product_id || null, name: names[i.product_id] || i.name || i.code || 'Not known', units: 0, requests: 0, reasons: {} }).get(k)
    p.units += n; p.requests += 1; p.reasons[reason || 'to_check'] = (p.reasons[reason || 'to_check'] || 0) + 1
  }
  for (const a of req) for (const i of a.items || []) add(i, Number(i.qty) || 1, a.reason)
  for (const r of got.filter(x => !x.rma)) for (const i of r.items || []) add(i, Number(i.qty) || 1, r.reason)
  t.products = [...prod.values()].map(p => {
    const s = p.product_id ? Number(sold[p.product_id]) || 0 : 0
    const top = Object.entries(p.reasons).sort((a, b) => b[1] - a[1])[0]
    return { ...p, sold: s, rate: s > 0 ? (p.units / s) * 100 : null, topReason: top ? top[0] : null }
  }).sort((a, b) => b.units - a.units)
  t.flagged = t.products.filter(p => p.rate != null && p.sold >= 20 && p.rate >= RATE_ALERT)
  const soldTotal = Object.values(sold).reduce((s, v) => s + (Number(v) || 0), 0)
  t.unitsSold = soldTotal
  t.rate = soldTotal > 0 ? (t.requestUnits / soldTotal) * 100 : null
  return t
}

/** Returns per day for the chart: { d, requests, arrived } for every day from..to */
export function returnsByDay({ returns = [], amazon = [] }, from, to) {
  const m = new Map()
  for (let d = new Date(`${from}T12:00:00Z`); day(d.toISOString()) <= to; d.setUTCDate(d.getUTCDate() + 1)) m.set(day(d.toISOString()), { d: day(d.toISOString()), requests: 0, arrived: 0 })
  for (const a of amazon) { const r = m.get(day(a.request_date)); if (r) r.requests++ }
  for (const x of returns) if (x.status !== 'expected') { const r = m.get(day(x.received_at || x.created_at)); if (r) r.arrived++ }
  return [...m.values()]
}
