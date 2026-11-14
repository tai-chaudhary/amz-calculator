/**
 * Amazon's Date Range "Transaction" report (Finance → Payment reports) → sales ledger lines (v2.75.0).
 * Keeps the money and the SKU; never the customer's town, county or postcode (the report has them).
 * Each line gets a key from what's in it, so importing the same file twice — or months that overlap — adds nothing.
 */
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 }
const n = (v) => { const x = parseFloat(String(v ?? '').replace(/[£,\s]/g, '')); return Number.isFinite(x) ? x : 0 }

/** "1 Aug 2026 00:28:34 UTC" → Date (UTC) */
export function parseAmazonDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const mon = MON[m[2].toLowerCase()]
  if (mon == null) return null
  return new Date(Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +m[6]))
}
const londonDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d)

/** rows: arrays from the CSV (header row found automatically) */
export function amazonTransactionsToLines(rows) {
  const hi = rows.findIndex(r => r.some(c => String(c).trim().toLowerCase() === 'date/time') && r.some(c => String(c).trim().toLowerCase() === 'total'))
  if (hi < 0) throw new Error('This isn’t an Amazon transaction report — no "date/time" and "total" columns found')
  const head = rows[hi].map(c => String(c).trim().toLowerCase())
  const at = (name) => head.indexOf(name)
  const C = Object.fromEntries(['date/time', 'type', 'order id', 'sku', 'description', 'quantity', 'fulfilment', 'fulfillment',
    'product sales', 'product sales tax', 'postage credits', 'shipping credits', 'shipping credits tax', 'gift wrap credits', 'giftwrap credits tax',
    'promotional rebates', 'promotional rebates tax', 'selling fees', 'fba fees', 'other transaction fees', 'other', 'total'].map(k => [k, at(k)]))
  const get = (r, k) => (C[k] >= 0 ? r[C[k]] : '')
  const seen = new Map()
  const lines = []; let skipped = 0
  for (const r of rows.slice(hi + 1)) {
    const when = parseAmazonDate(get(r, 'date/time'))
    if (!when) { if (r.some(c => String(c).trim())) skipped++; continue }
    const type = String(get(r, 'type') || '').trim()
    // Transfers are Amazon paying out to your bank — money moving, not income or cost
    const kind = /^order$/i.test(type) ? 'sale' : /^refund$/i.test(type) ? 'refund' : /^transfer$/i.test(type) ? 'transfer' : 'charge'
    const order = String(get(r, 'order id') || '').trim()
    const sku = String(get(r, 'sku') || '').trim()
    const total = n(get(r, 'total'))
    const base = [type, order, sku, when.toISOString(), total.toFixed(2), String(get(r, 'description') || '').trim().slice(0, 60)].join('|')
    const k = (seen.get(base) || 0) + 1; seen.set(base, k)
    lines.push({
      source_key: `amz:${base}|${k}`, kind, order_ref: order, sale_date: londonDay(when), posted_at: when.toISOString(),
      listing_sku: sku, description: (kind === 'charge' ? `${type}: ` : '') + String(get(r, 'description') || '').trim().slice(0, 200),
      qty: n(get(r, 'quantity')), fulfilment: String(get(r, 'fulfilment') || get(r, 'fulfillment') || '').trim(),
      product_sales: n(get(r, 'product sales')), product_tax: n(get(r, 'product sales tax')),
      shipping: n(get(r, 'postage credits')) + n(get(r, 'shipping credits')), shipping_tax: n(get(r, 'shipping credits tax')),
      giftwrap: n(get(r, 'gift wrap credits')), giftwrap_tax: n(get(r, 'giftwrap credits tax')),
      promo: n(get(r, 'promotional rebates')), promo_tax: n(get(r, 'promotional rebates tax')),
      selling_fees: n(get(r, 'selling fees')), fba_fees: n(get(r, 'fba fees')), other_fees: n(get(r, 'other transaction fees')),
      other: n(get(r, 'other')), total,
    })
  }
  return { lines, skipped }
}

// ── eBay and TikTok (v2.81.0) ──────────────────────────────────────────────────
const clean = (v) => { const s = String(v ?? '').trim(); return s === '--' || s === '/' ? '' : s }
const lower = (r) => r.map(c => String(c ?? '').trim().toLowerCase())

/** "14 Nov 2026" / "30 Sept 2026" → "2026-11-14" */
export function parseEbayDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})/)
  if (!m) return null
  const mon = MON[m[2].toLowerCase()] ?? MON[m[2].toLowerCase().slice(0, 3)]
  if (mon == null) return null
  return `${m[3]}-${String(mon + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`
}

const EBAY_FEES = ['final value fee – fixed', 'final value fee – variable', 'regulatory operating fee', "very high 'item not as described' fee", 'below standard performance fee', 'international fee']
// Money moving between eBay and the bank, or held and released again — not income or cost
const EBAY_MOVES = /^(payout|secondary payout|hold|charge|transfer|reserve|withheld tax)$/i

/**
 * eBay's Transaction report (Seller Hub → Payments → Reports) → sales ledger lines.
 * Buyer names, usernames and addresses in the file are never kept. eBay's fees include VAT.
 */
export function ebayTransactionsToLines(rows) {
  const hi = rows.findIndex(r => { const h = lower(r); return h.includes('transaction creation date') && h.includes('net amount') })
  if (hi < 0) throw new Error('This isn’t an eBay transaction report — no "Transaction creation date" and "Net amount" columns found')
  const head = lower(rows[hi])
  const get = (r, k) => { const i = head.indexOf(k); return i >= 0 ? clean(r[i]) : '' }
  const seen = new Map(); const lines = []; let skipped = 0
  for (const r of rows.slice(hi + 1)) {
    const day = parseEbayDate(get(r, 'transaction creation date'))
    if (!day) { if (r.some(c => clean(c))) skipped++; continue }
    const type = get(r, 'type'); const order = get(r, 'order number'); const item = get(r, 'item id')
    const label = get(r, 'custom label'); const net = n(get(r, 'net amount')); const gross = n(get(r, 'gross transaction amount'))
    const desc = get(r, 'description'); const title = get(r, 'item title')
    const fees = +EBAY_FEES.reduce((s, k) => s + n(get(r, k)), 0).toFixed(2)
    const sub = n(get(r, 'item subtotal')); const post = n(get(r, 'postage and packaging'))
    let line
    if (/^order$/i.test(type)) {
      if (!item && !get(r, 'item subtotal')) continue          // the summary row of an order with several items — the item rows carry the money
      line = { kind: 'sale', product_sales: sub, shipping: post, selling_fees: fees, total: get(r, 'net amount') ? net : +(sub + post + fees).toFixed(2), qty: n(get(r, 'quantity')) }
    } else if (/^(refund|claim|payment dispute)$/i.test(type)) {
      line = { kind: 'refund', product_sales: gross || net, selling_fees: fees, total: net, qty: 0 }
    } else if (EBAY_MOVES.test(type)) {
      line = { kind: 'transfer', other: net, total: net, qty: 0 }
    } else {
      line = { kind: 'charge', other_fees: net, total: net, qty: 0 }   // Promoted Listings, insertion and shop fees, postage labels, adjustments
    }
    const ref = get(r, 'transaction id') || get(r, 'reference id') || get(r, 'payout id')
    const base = [type, order, item, day, net.toFixed(2), ref, desc.slice(0, 40)].join('|')
    const k = (seen.get(base) || 0) + 1; seen.set(base, k)
    lines.push({
      source_key: `ebay:${base}|${k}`, order_ref: order, sale_date: day, posted_at: null,
      listing_sku: label || item, item_code: item, fulfilment: 'Seller',
      description: [line.kind === 'sale' || line.kind === 'refund' ? '' : `${type}: `, desc || title].join('').trim().slice(0, 200),
      product_sales: 0, product_tax: 0, shipping: 0, shipping_tax: 0, promo: 0, selling_fees: 0, other_fees: 0, other: 0, ...line,
    })
  }
  return { lines, skipped }
}

/**
 * TikTok Shop's Income report (Finance → Statements → Export), sheet "Order details" → sales ledger lines.
 * Only orders TikTok has settled are in it; the rest stay as HELM's figures until a later report holds them.
 */
export function tiktokIncomeToLines(rows) {
  const hi = rows.findIndex(r => { const h = lower(r); return h.includes('order/adjustment id') && h.includes('total settlement amount') })
  if (hi < 0) throw new Error('This isn’t a TikTok income report — no "Order/adjustment ID" and "Total settlement amount" columns found')
  const head = lower(rows[hi])
  const get = (r, k) => { const i = head.indexOf(k); return i >= 0 ? clean(r[i]) : '' }
  const day = (s) => { const m = String(s || '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null }
  const seen = new Map(); const lines = []; let skipped = 0
  for (const r of rows.slice(hi + 1)) {
    const id = get(r, 'order/adjustment id'); const stmt = day(get(r, 'statement date'))
    if (!id || !stmt) { if (r.some(c => clean(c))) skipped++; continue }
    const type = get(r, 'type'); const sku = get(r, 'sku id'); const total = n(get(r, 'total settlement amount'))
    const isOrder = /^order$/i.test(type)
    const kind = isOrder ? 'sale' : /negative balance|deduction/i.test(type) ? 'transfer' : 'charge'
    const base = [type, id, sku, stmt, total.toFixed(2)].join('|')
    const k = (seen.get(base) || 0) + 1; seen.set(base, k)
    lines.push({
      source_key: `tiktok:${base}|${k}`, kind, order_ref: get(r, 'related order id') || id,
      sale_date: (isOrder && day(get(r, 'order created date'))) || stmt, posted_at: null,
      listing_sku: sku, item_code: sku, fulfilment: 'Seller',
      description: (isOrder ? [get(r, 'product name'), get(r, 'sku name')].filter(Boolean).join(' — ') : `${type}: ${get(r, 'adjustment reason')}`).slice(0, 200),
      qty: isOrder ? n(get(r, 'quantity')) : 0,
      product_sales: isOrder ? n(get(r, 'net sales')) : 0, product_tax: 0,
      shipping: isOrder ? n(get(r, 'shipping')) : 0, shipping_tax: 0, promo: 0,
      selling_fees: isOrder ? n(get(r, 'fees')) : 0, other_fees: kind === 'charge' ? total : 0,
      other: isOrder ? n(get(r, 'adjustment amount')) : (kind === 'transfer' ? total : 0), total,
    })
  }
  return { lines, skipped }
}

/**
 * Which report a file is, from its sheets. sheets: [{ name, rows }]. Returns { type, source, label, lines, skipped }.
 */
export function readSalesReport(sheets) {
  const has = (rows, a, b) => rows.some(r => { const h = lower(r); return h.includes(a) && h.includes(b) })
  for (const s of sheets) {
    if (has(s.rows, 'date/time', 'total')) return { type: 'amazon', source: 'amazon_report', label: 'Amazon transaction report', ...amazonTransactionsToLines(s.rows) }
    if (has(s.rows, 'transaction creation date', 'net amount')) return { type: 'ebay', source: 'ebay_report', label: 'eBay transaction report', ...ebayTransactionsToLines(s.rows) }
    if (has(s.rows, 'order/adjustment id', 'total settlement amount')) return { type: 'tiktok', source: 'tiktok_report', label: 'TikTok income report', ...tiktokIncomeToLines(s.rows) }
  }
  if (sheets.some(s => has(s.rows, 'order id', 'sku subtotal after discount'))) {
    throw new Error('This is TikTok’s order list. HELM already brings those orders in — for TikTok’s fees, upload the Income report instead (Finance → Statements → Export).')
  }
  throw new Error('This isn’t a report the portal knows. It takes the Amazon transaction report, the eBay transaction report and the TikTok income report.')
}

/**
 * Rows of a sheet, reading every cell that is really there. TikTok's Excel files say the sheet is smaller than it is
 * (the stated size stops after the first statement), so the size is worked out from the cells instead.
 * utils: XLSX.utils
 */
export function sheetRows(ws, utils) {
  let maxR = -1, maxC = -1
  for (const key of Object.keys(ws || {})) {
    if (key[0] === '!') continue
    const c = utils.decode_cell(key)
    if (c.r > maxR) maxR = c.r
    if (c.c > maxC) maxC = c.c
  }
  if (maxR < 0) return []
  const range = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } })
  return utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', range })
}
