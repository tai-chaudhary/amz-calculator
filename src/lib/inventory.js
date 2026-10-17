/**
 * Inventory: shelves, stock counts, sales history and what to reorder.
 * Everything here is plain logic with no database, so it can be tested.
 * Nothing here knows or shows a price.
 */

export const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)

// ── Shelves ──────────────────────────────────────────────────────────────────
// Aisle-Bay-Shelf-Section: A-10-0-1 is aisle A, bay 10, shelf 0 (ground), section 1.

export const AISLES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
export const baysIn = (aisle) => (aisle === 'D' ? 11 : 10)
export const MAX_SHELF = 7
export const SECTIONS = 4

/** "a 10 0 1", "A10-0-1", "a-10-0-1" → "A-10-0-1"; null if it can't be a shelf. */
export function cleanLocation(input) {
  const s = String(input || '').toUpperCase().trim()
  const m = s.match(/^([A-H])\s*[-\s./]?\s*(\d{1,2})\s*[-\s./]\s*(\d)\s*[-\s./]\s*(\d)$/)
  if (!m) return null
  const [, aisle, bay, shelf, section] = m
  const code = `${aisle}-${+bay}-${+shelf}-${+section}`
  return validLocation(code) ? code : null
}

export function parseLocation(code) {
  const m = String(code || '').match(/^([A-H])-(\d{1,2})-(\d)-(\d)$/)
  if (!m) return null
  return { aisle: m[1], bay: +m[2], shelf: +m[3], section: +m[4] }
}

export function validLocation(code) {
  const p = parseLocation(code)
  return !!p && p.bay >= 1 && p.bay <= baysIn(p.aisle) && p.shelf >= 0 && p.shelf <= MAX_SHELF && p.section >= 1 && p.section <= SECTIONS
}

/** Why a typed shelf isn't one, in words. */
export function locationProblem(input) {
  const s = String(input || '').trim()
  if (!s) return 'Enter a shelf, e.g. A-10-0-1'
  if (cleanLocation(s)) return null
  const m = s.toUpperCase().match(/^([A-Z])\s*[-\s./]?\s*(\d{1,2})\s*[-\s./]\s*(\d+)\s*[-\s./]\s*(\d+)$/)
  if (!m) return 'Use Aisle-Bay-Shelf-Section, e.g. A-10-0-1'
  if (!AISLES.includes(m[1])) return `There’s no aisle ${m[1]} — aisles are A to H`
  if (+m[2] < 1 || +m[2] > baysIn(m[1])) return `Aisle ${m[1]} has bays 1 to ${baysIn(m[1])}`
  if (+m[3] > MAX_SHELF) return `Shelves go from 0 (the ground) to ${MAX_SHELF}`
  if (+m[4] < 1 || +m[4] > SECTIONS) return 'Sections are 1 to 4'
  return 'Use Aisle-Bay-Shelf-Section, e.g. A-10-0-1'
}

/** Walking order: aisle, bay, shelf, section. */
export function byLocation(a, b) {
  const x = parseLocation(typeof a === 'string' ? a : a?.code)
  const y = parseLocation(typeof b === 'string' ? b : b?.code)
  if (!x || !y) return (x ? -1 : 0) - (y ? -1 : 0)
  return x.aisle.localeCompare(y.aisle) || x.bay - y.bay || x.shelf - y.shelf || x.section - y.section
}

export const shelfLabel = (shelf) => (shelf === 0 ? 'Ground' : `Shelf ${shelf}`)

// ── Reasons for changing stock by hand ───────────────────────────────────────
// Anything that arrives on an order goes through Goods In, and anything sold
// goes through Dispatch. A change by hand has to say why it didn't.

export const ADD_REASONS = [
  { id: 'Found stock', hint: 'Turned up somewhere it wasn’t recorded' },
  { id: 'Customer return', hint: 'Came back and is fit to sell again' },
  { id: 'Arrived without going through Goods In', hint: 'Say which delivery in the note', note: true },
  { id: 'Count correction', hint: 'The number was wrong' },
  { id: 'Other', hint: 'Say what happened', note: true },
]

export const REMOVE_REASONS = [
  { id: 'Damaged', hint: 'Can’t be sold' },
  { id: 'Lost or missing', hint: 'Should be here but isn’t' },
  { id: 'Used in the business', hint: 'Samples, testing, the office' },
  { id: 'Returned to supplier' },
  { id: 'Sent out without a label', hint: 'Say what order or who to', note: true },
  { id: 'Count correction', hint: 'The number was wrong' },
  { id: 'Other', hint: 'Say what happened', note: true },
]

export const needsNote = (reason, list) => !!list.find(r => r.id === reason)?.note

export const MOVEMENT_LABEL = {
  opening: 'Opening count', count: 'Counted', goods_in: 'Goods in', move: 'Moved',
  add: 'Added by hand', remove: 'Removed by hand', despatch: 'Despatched', despatch_undo: 'Despatch undone',
  damage: 'Reported damaged', damage_restock: 'Damaged stock put back',
}

// ── Reading a stock count sheet ──────────────────────────────────────────────

const HEADS = {
  location: ['location code', 'location'],
  type: ['stock location type', 'location type'],
  name: ['product name', 'name'],
  code: ['product code', 'code', 'sku'],
  helm: ['helm status'],
  ptype: ['product type', 'type'],
  qty: ['stock quantity', 'quantity', 'qty'],
}

/**
 * Rows of the "Stock by Location" sheet (as arrays) into stock lines.
 * Finds the header row itself, reads only the columns it needs, and lists
 * anything it can't use rather than guessing.
 */
export function readCountSheet(aoa = []) {
  const lower = (v) => String(v ?? '').trim().toLowerCase()
  const at = aoa.findIndex(r => (r || []).some(c => lower(c) === 'location code') && (r || []).some(c => lower(c) === 'product code'))
  if (at < 0) return { rows: [], problems: ['Couldn’t find the “Location Code” and “Product Code” headings'] }
  const head = aoa[at].map(lower)
  const col = Object.fromEntries(Object.entries(HEADS).map(([k, names]) => [k, head.findIndex(h => names.includes(h))]))
  const out = new Map()
  const problems = []
  for (let i = at + 1; i < aoa.length; i++) {
    const r = aoa[i] || []
    const raw = String(r[col.location] ?? '').trim()
    const code = String(r[col.code] ?? '').trim()
    if (!raw && !code) continue
    const location = cleanLocation(raw)
    if (!location) { problems.push(`Row ${i + 1}: “${raw}” isn’t a shelf`); continue }
    if (!code) { problems.push(`Row ${i + 1}: no product code`); continue }
    const qty = num(r[col.qty])
    if (qty < 0) { problems.push(`Row ${i + 1}: a negative quantity`); continue }
    const key = `${location}|${norm(code)}`
    const prev = out.get(key)
    out.set(key, {
      location, code: code.toUpperCase(),
      name: String(r[col.name] ?? '').trim() || code,
      pickable: col.type >= 0 ? /^pick/i.test(String(r[col.type] ?? '').trim()) : false,
      in_helm: col.helm >= 0 ? !/not/i.test(String(r[col.helm] ?? '')) : true,
      group: col.ptype >= 0 && /group/i.test(String(r[col.ptype] ?? '')),
      qty: (prev?.qty || 0) + qty,
    })
  }
  return { rows: [...out.values()], problems }
}

/**
 * A pack counted as a pack ("6 x Radox …", code …-6PK) becomes its single,
 * counted in singles. HELM's own bundle list decides when it has the pack;
 * otherwise the name and code are read.
 */
export function packToSingles(rows = [], helmItems = []) {
  const helm = new Map(helmItems.map(h => [norm(h.code), h]))
  const conversions = []
  const out = rows.map(r => {
    if (!r.group) return r
    const h = helm.get(norm(r.code))
    const parts = h?.components || []
    if (parts.length === 1 && parts[0].code && norm(parts[0].code) !== norm(r.code)) {
      const units = Math.max(1, parseInt(parts[0].units, 10) || 1)
      const single = helm.get(norm(parts[0].code))
      const to = { ...r, code: String(parts[0].code).toUpperCase(), name: single?.name || parts[0].name || r.name, qty: r.qty * units, group: false }
      conversions.push({ from: r, to, units, how: 'HELM' })
      return to
    }
    const lead = String(r.name).match(/^\s*(\d+)\s*[x×]\s*/i)
    const pk = String(r.code).match(/[-_](\d+)\s*PK$/i)
    const units = lead ? +lead[1] : pk ? +pk[1] : 1
    if (units <= 1) return { ...r, group: false }
    const to = {
      ...r, group: false, qty: r.qty * units,
      code: String(r.code).replace(/[-_]\d+\s*PK$/i, '').toUpperCase(),
      name: String(r.name).replace(/^\s*\d+\s*[x×]\s*/i, '').trim(),
    }
    conversions.push({ from: r, to, units, how: 'name' })
    return to
  })
  // Two rows can now be the same single on the same shelf
  const merged = new Map()
  for (const r of out) {
    const k = `${r.location}|${norm(r.code)}`
    if (merged.has(k)) merged.get(k).qty += r.qty
    else merged.set(k, { ...r })
  }
  return { rows: [...merged.values()], conversions }
}

// ── Marketplace sales history ────────────────────────────────────────────────

/** A date-time as the London calendar day. */
export function londonDay(iso) {
  const d = new Date(iso)
  if (Number.isNaN(+d)) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d)
}

/**
 * Amazon's order report (tab-separated) into sales lines. Only the order
 * number, SKU, title, quantity and day are kept — no names, addresses or
 * anything else about the customer. Cancelled orders are left out, and so
 * are orders with no shipping status that are more than two weeks old
 * (those were cancelled before they went).
 */
export function parseAmazonOrders(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return { rows: [], skipped: { cancelled: 0, unshipped: 0 }, problem: 'The file is empty' }
  const head = lines[0].split('\t').map(h => h.trim().toLowerCase())
  const ix = (n) => head.indexOf(n)
  const c = { id: ix('order-id'), date: ix('purchase-date'), sku: ix('sku'), title: ix('product-name'), qty: ix('quantity-purchased'),
    status: ix('shipment-status'), cancel: ix('is-buyer-requested-cancellation'), orderStatus: ix('order-status') }
  if (c.id < 0 || c.sku < 0 || c.qty < 0 || c.date < 0) {
    return { rows: [], skipped: { cancelled: 0, unshipped: 0 }, problem: 'This doesn’t look like an Amazon order report — it needs order-id, sku, quantity-purchased and purchase-date' }
  }
  const raw = lines.slice(1).map(l => l.split('\t'))
  const days = raw.map(r => londonDay(r[c.date])).filter(Boolean).sort()
  const last = days[days.length - 1]
  const cutoff = last ? new Date(new Date(`${last}T12:00:00Z`).getTime() - 14 * 86400000).toISOString().slice(0, 10) : null
  const rows = []
  const skipped = { cancelled: 0, unshipped: 0 }
  for (const r of raw) {
    const day = londonDay(r[c.date])
    const qty = parseInt(r[c.qty], 10) || 0
    if (!day || !qty || !r[c.sku]) continue
    if ((c.cancel >= 0 && /^true$/i.test(r[c.cancel] || '')) || (c.orderStatus >= 0 && /cancel/i.test(r[c.orderStatus] || ''))) { skipped.cancelled++; continue }
    if (c.status >= 0 && !String(r[c.status] || '').trim() && cutoff && day < cutoff) { skipped.unshipped++; continue }
    rows.push({ orderId: r[c.id].trim(), sku: r[c.sku].trim(), title: (c.title >= 0 ? r[c.title] : '').trim(), qty, day })
  }
  return { rows, skipped, from: days[0], to: last }
}

/** Units per SKU per day. */
export function salesByDay(rows = []) {
  const m = new Map()
  for (const r of rows) {
    const k = `${r.day}\u0000${r.sku}`
    if (!m.has(k)) m.set(k, { day: r.day, sku: r.sku, units: 0 })
    m.get(k).units += r.qty
  }
  return [...m.values()]
}

/** Each SKU with its title, total sold and order count, busiest first. */
export function skuSummary(rows = []) {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.sku)) m.set(r.sku, { sku: r.sku, title: r.title, units: 0, orders: new Set() })
    const s = m.get(r.sku); s.units += r.qty; s.orders.add(r.orderId)
  }
  return [...m.values()].map(s => ({ ...s, orders: s.orders.size })).sort((a, b) => b.units - a.units)
}

const sig = (items) => items.map(i => `${norm(i.code)}x${i.qty}`).sort().join('+')

/**
 * What each SKU is, learned from orders that went through Dispatch: an
 * order with one SKU on Amazon and the HELM items on its packing slip says
 * what one of that SKU is. The answer most orders agree on wins.
 * slipsByRef: { normalised order number: [{code, qty}] }
 */
export function learnSkus(rows = [], slipsByRef = {}) {
  const orders = new Map()
  for (const r of rows) {
    if (!orders.has(r.orderId)) orders.set(r.orderId, [])
    orders.get(r.orderId).push(r)
  }
  const votes = new Map()   // sku → signature → { items, n }
  const seen = new Map()
  for (const [id, lines] of orders) {
    const skus = [...new Set(lines.map(l => l.sku))]
    const slip = slipsByRef[norm(id)]
    if (skus.length !== 1 || !slip?.length) continue
    const sku = skus[0]
    const sold = lines.reduce((s, l) => s + l.qty, 0)
    seen.set(sku, (seen.get(sku) || 0) + 1)
    const per = slip.map(i => ({ code: String(i.code).trim(), qty: (parseFloat(i.qty) || 0) / sold }))
    if (per.some(i => !i.code || !(i.qty > 0) || Math.abs(i.qty - Math.round(i.qty)) > 1e-9)) continue
    const items = per.map(i => ({ code: i.code, qty: Math.round(i.qty) }))
    if (!votes.has(sku)) votes.set(sku, new Map())
    const v = votes.get(sku); const s = sig(items)
    v.set(s, { items, n: (v.get(s)?.n || 0) + 1 })
  }
  const out = {}
  for (const [sku, v] of votes) {
    const best = [...v.values()].sort((a, b) => b.n - a.n)[0]
    out[sku] = { items: best.items, agree: best.n, of: seen.get(sku) || best.n }
  }
  return out
}

/** How many are in one sale, read from a SKU or title: "3x …", "3 PCS", "Pack of 6", "-X003". */
export function packOf(sku = '', title = '') {
  const s = `${sku} ${title}`
  const m = s.match(/^\s*(\d{1,2})\s*[x×]\s*/i) || String(title).match(/^\s*(\d{1,2})\s*[x×]\s*/i)
    || s.match(/\b(\d{1,2})\s*(?:pcs|pieces|pack\b|pk\b)/i) || s.match(/pack of (\d{1,2})/i)
    || s.match(/\((\d{1,2})\s*x\s*cans?\)/i) || String(sku).match(/-X0*(\d{1,2})$/i)
  const n = m ? parseInt(m[1], 10) : 1
  return n >= 1 && n <= 48 ? n : 1
}

const WORDS_SKIP = new Set('the and for with of in a an to by on pack x pcs pieces day days next 2days nd uk new'.split(' '))
const words = (s) => String(s || '').toLowerCase()
  .replace(/(\d)\s*(?:litres?|liters?|ltrs?)\b/g, '$1l').replace(/(\d)\.0(l|kg)\b/g, '$1$2')
  .replace(/(\d)\s+(ml|l|kg|g)\b/g, '$1$2')
  .split(/[^a-z0-9.]+/).filter(w => w && !WORDS_SKIP.has(w))

/** Products a SKU most likely is, best first, with how many in one sale. */
export function suggestProducts(sku, title, products = [], limit = 5) {
  const want = new Set([...words(sku), ...words(title)])
  const scored = products.map(p => {
    const have = words(p.name)
    let score = 0
    for (const w of have) if (want.has(w)) score += /\d/.test(w) ? 3 : 1
    return { product: p, score: score / Math.sqrt(have.length || 1) }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(x => ({ ...x, units: packOf(sku, title) }))
}

// ── How long stock will last, and what to reorder ────────────────────────────

/** Days the stock left will last at the rate it sells. */
export const coverDays = (available, daily) => (daily > 0 ? Math.max(0, available) / daily : null)

export const BUFFER_DAYS = 15

/**
 * Where a product stands: out, will run out before an order could arrive,
 * under the 15-day buffer, fine — or still learning how fast it sells.
 * Stock already on order counts towards what's coming.
 */
export function stockState(p = {}) {
  const daily = num(p.daily)
  const available = num(p.available)
  const onOrder = num(p.on_order)
  const lead = Math.max(1, num(p.lead) || 7)
  const learning = num(p.rate_days) < 14 && !num(p.daily_override)
  const cover = coverDays(available + onOrder, daily)
  const reorderAt = Math.ceil(daily * (lead + BUFFER_DAYS))
  const suggest = daily > 0 ? Math.max(0, Math.ceil(daily * (lead + BUFFER_DAYS * 2)) - Math.max(0, available) - onOrder) : 0
  let state = 'ok'
  if (available <= 0 && onOrder <= 0) state = 'out'
  else if (daily <= 0) state = learning ? 'learning' : 'no_sales'
  else if (cover < lead) state = 'low'
  else if (cover < lead + BUFFER_DAYS) state = 'running_low'
  return { state, cover, reorderAt, suggest, lead, learning, daily }
}

export const STATE_LABEL = {
  out: { label: 'Out of stock', tone: 'alert' },
  low: { label: 'Order now', tone: 'alert' },
  running_low: { label: 'Under 15 days', tone: 'paused' },
  ok: { label: 'OK', tone: 'live' },
  learning: { label: 'Learning', tone: 'quiet' },
  no_sales: { label: 'No recent sales', tone: 'quiet' },
}

/** What a restock suggestion's urgency is as a stock request. */
export const requestUrgency = (state) => (state === 'out' ? 'out' : state === 'low' ? 'running_low' : 'low')

export const needsRestock = (s) => ['out', 'low', 'running_low'].includes(s.state)

export const fmtUnits = (n) => Math.round(num(n)).toLocaleString('en-GB')
export const fmtDays = (d) => (d == null ? '—' : d < 1 ? 'under a day' : d >= 365 ? 'a year +' : `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'}`)

/** Search across a product's name, code and shelves. */
export function matchesProduct(p, q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return true
  const hay = `${p.name} ${p.code} ${(p.locations || []).map(l => l.code).join(' ')}`.toLowerCase()
  return s.split(/\s+/).every(w => hay.includes(w) || norm(hay).includes(norm(w)))
}

// ── Damage ───────────────────────────────────────────────────────────────────

export const DAMAGE_REASONS = [
  { id: 'Damaged when picking', hint: 'Dropped or knocked taking it off the shelf' },
  { id: 'Damaged when packing', hint: 'Broke or split while packing the order' },
  { id: 'Found damaged when opened', hint: 'A case or box opened to find it damaged' },
  { id: 'Arrived damaged from supplier', hint: 'Noticed after it was put away' },
  { id: 'Damaged in storage or moving', hint: 'Fell, crushed, forklift, pallet' },
  { id: 'Leaking or out of date', hint: 'Can’t be sold as it is' },
  { id: 'Customer return, not resellable' },
  { id: 'Other', hint: 'Say what happened', note: true },
]

export const DAMAGE_STATUS = {
  open: { label: 'Waiting for the office', tone: 'paused' },
  written_off: { label: 'Written off', tone: 'quiet' },
  returned: { label: 'Back to supplier', tone: 'brand' },
  restocked: { label: 'Back on a shelf', tone: 'live' },
}

// ── Slow stock and value ─────────────────────────────────────────────────────

export const SLOW_DAYS = 60
export const OVERSTOCK_DAYS = 120

/**
 * Whether stock is tied up: nothing sold for 60 days, or more than four
 * months of it at the rate it sells. today: 'YYYY-MM-DD'.
 */
export function slowState({ on_hand, last_sold, daily }, today) {
  if (!(num(on_hand) > 0)) return null
  const since = last_sold ? Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${last_sold}T12:00:00Z`)) / 86400000) : null
  if (since == null || since >= SLOW_DAYS) return { kind: 'slow', since }
  const d = num(daily)
  if (d > 0 && num(on_hand) / d > OVERSTOCK_DAYS) return { kind: 'over', days: Math.round(num(on_hand) / d) }
  return null
}

export const fmtMoney = (n) => (n == null ? '—' : `£${num(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
export const fmtMoney0 = (n) => (n == null ? '—' : `£${Math.round(num(n)).toLocaleString('en-GB')}`)

/** A stock request filled in from what the stock says: how many to order, how urgent, and why. */
export function requestPrefill(p) {
  const st = p.st || stockState(p)
  return {
    stock_item_id: p.stock_item_id || null, product_name: p.name, helm_sku: p.code,
    qty_requested: st.suggest || '', urgency: requestUrgency(st.state),
    note: st.daily > 0
      ? `From stock: ${fmtUnits(p.available)} available, lasts ${fmtDays(st.cover)} at ${st.daily.toFixed(1)} a day`
      : `From stock: ${fmtUnits(p.available)} available`,
  }
}
