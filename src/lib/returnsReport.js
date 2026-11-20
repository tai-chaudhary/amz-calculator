/**
 * Amazon's returns report (Seller Central → Reports → Returns), read in the browser (v2.111.0).
 *
 * Two formats, both accepted: the XML download (quicker to get, the owner's choice) and the tab-separated text file.
 * Each return request becomes one plain object with the field names of the `amazon_returns` table; the database
 * (amazon_returns_upsert) keeps one row per RMA and updates it on every upload. The report holds no customer details.
 *
 * The XML is read with a small tag reader rather than DOMParser so the same code runs in the tests (node) and the
 * browser. Amazon's file is flat: <return_details> blocks with leaf tags, some inside <item_details>,
 * <label_details> and <safet_claim_details>.
 */

const XML_FIELDS = {
  amazon_rma_id: 'rma', order_id: 'order_ref', order_date: 'order_date', return_request_date: 'request_date',
  return_request_status: 'status', label_type: 'label_type', label_cost: 'label_cost', label_to_be_paid_by: 'label_paid_by',
  return_carrier: 'carrier', tracking_id: 'tracking', a_to_z_claim: 'a_to_z', is_prime: 'prime', asin: 'asin',
  merchant_sku: 'sku', item_name: 'item_name', return_quantity: 'qty', return_reason_code: 'reason_code', in_policy: 'in_policy',
  return_type: 'return_type', resolution: 'resolution', return_delivery_date: 'delivered_at', order_amount: 'order_amount',
  order_quantity: 'order_qty', refund_amount: 'refund_amount', safet_action_reason: 'safet_reason', safet_claim_id: 'safet_claim_id',
  safet_claim_state: 'safet_state', safet_claim_creation_time: 'safet_created_at', safet_claim_reimbursement_amount: 'safet_amount',
  category: 'category', order_item_id: 'order_item_id',
}

// The text file's headings → the same names
const TSV_FIELDS = {
  'order id': 'order_ref', 'order date': 'order_date', 'return request date': 'request_date', 'return request status': 'status',
  'amazon rma id': 'rma', 'label type': 'label_type', 'label cost': 'label_cost', 'return carrier': 'carrier', 'tracking id': 'tracking',
  'label to be paid by': 'label_paid_by', 'a-to-z claim': 'a_to_z', 'is prime': 'prime', asin: 'asin', 'merchant sku': 'sku',
  'item name': 'item_name', 'return quantity': 'qty', 'return reason': 'reason_code', 'in policy': 'in_policy', 'return type': 'return_type',
  resolution: 'resolution', 'return delivery date': 'delivered_at', 'order amount': 'order_amount', 'order quantity': 'order_qty',
  'safet action reason': 'safet_reason', 'safet claim id': 'safet_claim_id', 'safet claim state': 'safet_state',
  'safet claim creation time': 'safet_created_at', 'safet claim reimbursement amount': 'safet_amount', 'refunded amount': 'refund_amount',
  category: 'category', 'order item id': 'order_item_id',
}

const DATE_FIELDS = ['order_date', 'request_date', 'delivered_at', 'safet_created_at']
const NUM_FIELDS = ['label_cost', 'order_amount', 'refund_amount', 'safet_amount']
const INT_FIELDS = ['qty', 'order_qty']
const BOOL_FIELDS = ['a_to_z', 'prime', 'in_policy']

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescape = (s) => String(s).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => (ENT[e.toLowerCase()] ?? (e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)))))

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
/** "11-Nov-2026" (TSV) or "2026-11-11T19:36:10Z" (XML) → ISO; a TSV date is taken as midday UTC so it never slips a day */
export function toIso(v) {
  const s = String(v || '').trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (m && MON[m[2].toLowerCase()] != null) return new Date(Date.UTC(Number(m[3]), MON[m[2].toLowerCase()], Number(m[1]), 12)).toISOString()
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const toBool = (v) => /^(y|yes|true|1)$/i.test(String(v || '').trim())
const toNum = (v) => { const s = String(v ?? '').trim(); if (!s) return null; const n = Number(s.replace(/[£,]/g, '')); return Number.isFinite(n) ? n : null }

/** Tidy one raw request: types, blanks to null, and nothing that isn't a known field */
export function cleanRow(raw) {
  const r = {}
  for (const [k, v0] of Object.entries(raw)) {
    const v = typeof v0 === 'string' ? v0.trim() : v0
    if (v == null || v === '') continue
    if (DATE_FIELDS.includes(k)) r[k] = toIso(v)
    else if (NUM_FIELDS.includes(k)) r[k] = toNum(v)
    else if (INT_FIELDS.includes(k)) { const n = toNum(v); r[k] = n == null ? null : Math.round(n) }
    else if (BOOL_FIELDS.includes(k)) r[k] = toBool(v)
    else r[k] = String(v)
  }
  // Amazon writes a refund it has not made as 0.0 in the XML (blank in the TSV): both mean "not refunded"
  if (r.refund_amount === 0) delete r.refund_amount
  return r
}

export function parseReturnsXml(text) {
  const out = []
  const blocks = String(text).match(/<return_details>[\s\S]*?<\/return_details>/g) || []
  for (const b of blocks) {
    const raw = {}
    for (const m of b.matchAll(/<([a-z_]+)>([^<]*)<\/\1>/g)) { const f = XML_FIELDS[m[1]]; if (f) raw[f] = unescape(m[2]) }
    out.push(cleanRow(raw))
  }
  return out
}

export function parseReturnsTsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const head = lines[0].split('\t').map(h => TSV_FIELDS[h.trim().toLowerCase()] || null)
  return lines.slice(1).map(l => {
    const cells = l.split('\t'), raw = {}
    head.forEach((f, i) => { if (f) raw[f] = cells[i] })
    return cleanRow(raw)
  })
}

/**
 * Read a returns report file's text. Returns { rows, format, from, to, problems }: rows without an RMA or order are
 * dropped and counted in `problems`; a file that isn't a returns report throws a plain-English error.
 */
export function readReturnsReport(text, name = '') {
  const t = String(text || '')
  const isXml = /<\?xml|<AmazonEnvelope|<return_details>/i.test(t.slice(0, 2000))
  let rows
  if (isXml) {
    if (!/<return_details>/.test(t)) throw new Error('This XML file has no returns in it. Download the Returns report from Seller Central.')
    rows = parseReturnsXml(t)
  } else {
    const first = t.replace(/^﻿/, '').split(/\r?\n/)[0] || ''
    if (!/amazon rma id/i.test(first) || !/order id/i.test(first)) throw new Error(`${name || 'This file'} isn't Amazon's returns report — it needs the "Order ID" and "Amazon RMA ID" columns.`)
    rows = parseReturnsTsv(t)
  }
  const good = rows.filter(r => r.rma && r.order_ref)
  // The same RMA twice in one file: the later line wins (it carries Amazon's latest state)
  const byRma = new Map(good.map(r => [r.rma, r]))
  const list = [...byRma.values()]
  const dates = list.map(r => r.request_date).filter(Boolean).sort()
  return { rows: list, format: isXml ? 'XML' : 'Text (TSV)', from: dates[0]?.slice(0, 10) || null, to: dates[dates.length - 1]?.slice(0, 10) || null, problems: rows.length - good.length }
}
