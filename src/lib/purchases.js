/**
 * Buying stock: from raising an order to the goods arriving and the invoice
 * being filed. Payment and delivery are tracked separately — on a credit
 * account the goods arrive weeks before the money leaves.
 */

export const CREDIT_STATUS = {
  draft:            { label: 'Draft', tone: 'quiet', short: 'Draft' },
  awaiting_payment: { label: 'Credit due back', tone: 'brand', short: 'Credit due' },
  completed:        { label: 'Credit received', tone: 'live', short: 'Received' },
  cancelled:        { label: 'Cancelled', tone: 'quiet', short: 'Cancelled' },
}

export const PO_STATUS = {
  draft:              { label: 'Draft', tone: 'quiet', short: 'Draft' },
  awaiting_payment:   { label: 'Sent for payment', tone: 'brand', short: 'For payment' },
  awaiting_delivery:  { label: 'Awaiting delivery', tone: 'paused', short: 'Awaiting delivery' },
  partially_received: { label: 'Part delivered', tone: 'paused', short: 'Part delivered' },
  received:           { label: 'Delivered — to close off', tone: 'brand', short: 'Delivered' },
  received:           { label: 'Delivered — to close off', tone: 'brand', short: 'Delivered' },
  completed:          { label: 'Completed', tone: 'live', short: 'Completed' },
  cancelled:          { label: 'Cancelled', tone: 'quiet', short: 'Cancelled' },
}

/**
 * Not every payment buys stock. Services, carriers and one-off costs go through
 * the same approval and payment route, but don't have products or deliveries.
 */
/** Money coming back: a refund, a credit for damages, a return. */
export const isCredit = (po) => po?.kind === 'credit_note'

export const CREDIT_REASONS = {
  refund: 'Refunded items',
  damaged: 'Damaged or missing goods',
  returned: 'Goods returned',
  overcharge: 'Overcharged',
  other: 'Something else',
}

export const PO_CATEGORIES = {
  stock: {
    label: 'Stock', icon: 'package', goods: true, kind: 'stock',
    description: 'Products for resale', payee: 'Supplier', noun: 'products',
    // They quote, you pay, they ship
    methods: ['proforma', 'online', 'phone'], defaultMethod: 'proforma', defaultTerms: 'prepay',
  },
  packaging: {
    label: 'Packaging & warehouse', icon: 'box', goods: true, kind: 'packaging',
    description: 'Mailers, boxes, tape, equipment', payee: 'Supplier', noun: 'items',
    methods: ['proforma', 'online', 'phone'], defaultMethod: 'online', defaultTerms: 'prepay',
  },
  carrier: {
    label: 'Carrier / shipping', icon: 'truck', goods: false, kind: 'carrier',
    description: 'Evri, DPD, DHL, pallet work', payee: 'Carrier', noun: 'charges',
    // Carriers invoice in arrears, usually on account
    methods: ['invoice', 'online'], defaultMethod: 'invoice', defaultTerms: 'credit', recurring: 'monthly',
  },
  marketing: {
    label: 'Marketing', icon: 'sparkles', goods: false, kind: 'marketing',
    description: 'Ads, photography, design', payee: 'Company', noun: 'work',
    methods: ['invoice', 'online', 'proforma'], defaultMethod: 'invoice', defaultTerms: 'prepay',
  },
  services: {
    label: 'Professional services', icon: 'briefcase', goods: false, kind: 'services',
    description: 'Accountants, legal, trademarks, software', payee: 'Company', noun: 'work',
    methods: ['invoice', 'online', 'proforma'], defaultMethod: 'invoice', defaultTerms: 'credit',
  },
  other: {
    label: 'Something else', icon: 'more', goods: false, kind: 'other',
    description: 'Anything that doesn’t fit', payee: 'Who’s being paid', noun: 'items',
    methods: ['invoice', 'online', 'proforma', 'phone'], defaultMethod: 'invoice', defaultTerms: 'prepay',
  },
}

export const ORDER_METHODS = {
  proforma: { label: 'They sent a proforma or quote', icon: 'upload', needs: 'proforma' },
  invoice:  { label: 'They’ve invoiced us', icon: 'receipt', needs: 'invoice' },
  online:   { label: 'Pay online / card', icon: 'external', needs: 'link' },
  phone:    { label: 'Agreed by phone or email', icon: 'user', needs: null },
}

/**
 * Who belongs where. Suppliers sell you stock and packaging; carriers move it;
 * everyone else — agencies, accountants, software — is a company you pay.
 */
export const DIRECTORIES = {
  suppliers: { label: 'Suppliers', singular: 'Supplier', kinds: ['stock', 'packaging'], icon: 'truck',
    description: 'Companies you buy stock and packaging from.' },
  carriers: { label: 'Carriers', singular: 'Carrier', kinds: ['carrier'], icon: 'truck',
    description: 'Who moves your parcels, what they charge, and what you spend with them.' },
  companies: { label: 'Companies', singular: 'Company', kinds: ['marketing', 'services', 'other'], icon: 'briefcase',
    description: 'Everyone else you pay — agencies, accountants, software, one-offs.' },
}
export const kindsOf = (s) => (s?.data?.kinds?.length ? s.data.kinds : ['stock'])
export const directoryOf = (s) => Object.entries(DIRECTORIES)
  .find(([, d]) => kindsOf(s).some(k => d.kinds.includes(k)))?.[0] || 'companies'
export const inDirectory = (s, key) => kindsOf(s).some(k => DIRECTORIES[key].kinds.includes(k))

/** The companies that belong on this kind of order. */
export function payeesFor(category, suppliers = []) {
  const kind = (PO_CATEGORIES[category] || PO_CATEGORIES.stock).kind
  const tagged = suppliers.filter(s => (s.data?.kinds || ['stock']).includes(kind))
  // Nothing tagged yet? Don't leave the list empty — offer everything, plus "add one"
  return (tagged.length ? tagged : suppliers).slice().sort((a, b) => a.name.localeCompare(b.name))
}

/** Bills like a carrier's monthly account repeat; offer to raise the next one. */
export const REPEATS = { none: 'Doesn’t repeat', weekly: 'Every week', monthly: 'Every month', quarterly: 'Every quarter', yearly: 'Every year' }
export function nextRepeat(from, repeat) {
  if (!repeat || repeat === 'none') return null
  const d = new Date(from || Date.now())
  if (repeat === 'weekly') d.setDate(d.getDate() + 7)
  if (repeat === 'monthly') d.setMonth(d.getMonth() + 1)
  if (repeat === 'quarterly') d.setMonth(d.getMonth() + 3)
  if (repeat === 'yearly') d.setFullYear(d.getFullYear() + 1)
  return d
}
export const categoryOf = (po) => PO_CATEGORIES[po?.category] || PO_CATEGORIES.stock
/** Only goods get delivered, so only goods orders wait on a delivery. */
export const expectsDelivery = (po) => categoryOf(po).goods && !isCredit(po)

/**
 * The status to show. Worked out from the lines rather than trusting what was
 * stored: if everything ordered has been received, it isn't awaiting delivery,
 * whatever an older record says.
 */
export function displayStatus(po, items = po?.items || []) {
  const stored = po?.status || 'draft'
  if (isCredit(po)) return stored
  if (['draft', 'cancelled', 'completed'].includes(stored)) return stored
  if (!expectsDelivery(po)) return stored
  const r = received(items)
  if (r.ordered > 0 && r.complete) return 'received'
  if (r.started) return 'partially_received'
  return stored
}

export const ISSUE_KINDS = {
  missing: 'Missing items', damaged: 'Damaged', wrong_item: 'Wrong item sent',
  short_dated: 'Short dated', other: 'Something else',
}

export const ISSUE_STATUS = {
  reported:             { label: 'Reported', tone: 'alert', open: true },
  chasing:              { label: 'Chasing supplier', tone: 'paused', open: true },
  replacement_due:      { label: 'Replacement promised', tone: 'brand', open: true },
  replacement_received: { label: 'Replacement received', tone: 'live', open: false },
  credited:             { label: 'Credited', tone: 'live', open: false },
  written_off:          { label: 'Written off', tone: 'quiet', open: false },
}

export const PAYMENT_METHODS = { bacs: 'BACS / bank transfer', card: 'Card (online)', direct_debit: 'Direct debit', cash: 'Cash', other: 'Other' }

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)

/** What the supplier will charge: lines, then VAT and delivery, to match the proforma. */
export function poTotals(items = [], { vatRate = 20, vatApplies = true, delivery = 0 } = {}) {
  const subtotal = items.reduce((s, i) => s + num(i.qty) * num(i.unit_cost), 0)
  const del = num(delivery)
  const vat = vatApplies ? (subtotal + del) * (num(vatRate) / 100) : 0
  return { subtotal: +subtotal.toFixed(2), delivery: +del.toFixed(2), vat: +vat.toFixed(2), total: +(subtotal + del + vat).toFixed(2) }
}

/** How much of the order has actually arrived. */
export function received(items = []) {
  const ordered = items.reduce((s, i) => s + num(i.qty), 0)
  const got = items.reduce((s, i) => s + Math.min(num(i.qty_received), num(i.qty)), 0)
  return {
    ordered, received: got, outstanding: Math.max(0, ordered - got),
    complete: ordered > 0 && got >= ordered,
    started: got > 0,
    percent: ordered > 0 ? Math.round((got / ordered) * 100) : 0,
  }
}

/** Where the money stands, and whether it's late. */
export function paymentState(po) {
  if (po.payment_status === 'paid') {
    return { label: `Paid${po.paid_at ? ` ${new Date(po.paid_at).toLocaleDateString('en-GB')}` : ''}`, tone: 'live', paid: true }
  }
  if (po.terms === 'credit') {
    if (!po.payment_due_at) return { label: 'On account — no due date set', tone: 'paused', paid: false }
    // Compare whole days: a date has no time of day, so "today" must not
    const due = new Date(po.payment_due_at + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const days = Math.round((due - today) / 86400000)
    if (days < 0) return { label: `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}`, tone: 'alert', paid: false, overdue: true, days }
    if (days <= 7) return { label: days === 0 ? 'Due today' : `Due in ${days} day${days !== 1 ? 's' : ''}`, tone: 'paused', paid: false, days }
    return { label: `Due ${due.toLocaleDateString('en-GB')}`, tone: 'quiet', paid: false, days }
  }
  return { label: 'Payment needed to release the order', tone: 'brand', paid: false }
}

/** Is this order waiting on money? Credit orders sit here too, until they're paid. */
export const awaitingPayment = (po) => !isCredit(po) && po.payment_status !== 'paid' && !['draft', 'cancelled'].includes(po.status)

/** The next thing to do, in plain words. */
export function nextStep(po, items = [], issues = []) {
  if (isCredit(po)) {
    return po.payment_status === 'paid' ? 'Credit received — nothing further'
      : po.status === 'draft' ? 'Check it and send it through'
      : 'Waiting for the money back'
  }
  const r = received(items)
  const goods = expectsDelivery(po)
  const openIssues = issues.filter(i => ISSUE_STATUS[i.status]?.open).length
  if (po.status === 'draft') return po.order_method === 'invoice' && !po.invoice_path
    ? 'Attach their invoice, then send for payment' : 'Review and send for payment'
  if (po.status === 'cancelled') return 'Cancelled'
  if (po.status === 'completed') return openIssues ? `${openIssues} issue${openIssues !== 1 ? 's' : ''} still open with the supplier` : 'Nothing — this one is done'
  if (goods && !r.complete) return po.payment_status !== 'paid' && po.terms === 'prepay' ? 'Waiting for payment before the supplier releases it' : 'Waiting for delivery'
  if (openIssues) return `${openIssues} problem${openIssues !== 1 ? 's' : ''} to settle with the supplier`
  if (!po.invoice_path) return 'Upload the supplier’s invoice'
  if (po.payment_status !== 'paid') return 'Waiting for payment'
  return 'Mark as completed'
}

/** Everything needed before an order can be closed off. */
export function completionChecks(po, items = [], issues = []) {
  if (isCredit(po)) return [
    { key: 'doc', label: 'Credit note attached', done: !!po.invoice_path || !!po.proforma_path, hint: 'Their credit note document' },
    { key: 'paid', label: 'Money received back', done: po.payment_status === 'paid', hint: 'Mark it when the refund lands' },
  ]
  const r = received(items)
  const goods = expectsDelivery(po)
  return [
    ...(goods ? [{ key: 'received', label: 'Everything ordered has arrived', done: r.complete,
      hint: r.started ? `${r.received} of ${r.ordered} received` : 'Nothing received yet' }] : []),
    { key: 'invoice', label: 'Final invoice uploaded', done: !!po.invoice_path, hint: 'Only the proforma is held so far' },
    { key: 'paid', label: 'Paid', done: po.payment_status === 'paid',
      hint: po.terms === 'credit' ? 'On account — payment may still be within terms' : 'Not paid yet' },
    { key: 'issues', label: 'No unresolved problems', done: !issues.some(i => ISSUE_STATUS[i.status]?.open),
      hint: `${issues.filter(i => ISSUE_STATUS[i.status]?.open).length} open with the supplier` },
  ]
}

/** Spend over a period, for the dashboard. */
export function spendSummary(orders = [], now = new Date()) {
  const start = (d) => { const x = new Date(now); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - d); return x }
  const monday = (() => { const x = new Date(now); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x })()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const live = orders.filter(o => o.status !== 'cancelled' && o.status !== 'draft')
  // Credits carry a negative total, so spend is automatically net of them
  const since = (from) => live.filter(o => new Date(o.sent_at || o.created_at) >= from).reduce((s, o) => s + num(o.total), 0)
  return {
    week: since(monday), month: since(monthStart), year: since(yearStart), last30: since(start(30)),
    awaitingPayment: live.filter(awaitingPayment).reduce((s, o) => s + num(o.total), 0),
    awaitingPaymentCount: live.filter(awaitingPayment).length,
    overdue: live.filter(o => paymentState(o).overdue).length,
    awaitingDelivery: live.filter(o => ['awaiting_delivery', 'partially_received'].includes(o.status)).length,
  }
}

/** Suggested payment due date for a credit account. */
export function dueDateFor(terms, days = 30, from = new Date()) {
  if (terms !== 'credit') return null
  const d = new Date(from)
  d.setDate(d.getDate() + (parseInt(days) || 30))
  return d.toISOString().slice(0, 10)
}

/** Spend split by what it was for — the view an accountant asks for. */
export function spendByCategory(orders = [], from, to) {
  const out = {}
  for (const o of orders) {
    if (['draft', 'cancelled'].includes(o.status)) continue
    const at = new Date(o.sent_at || o.created_at)
    if (from && at < from) continue
    if (to && at > to) continue
    const key = o.category || 'stock'
    out[key] = out[key] || { total: 0, vat: 0, count: 0 }
    out[key].total += parseFloat(o.total) || 0
    out[key].vat += parseFloat(o.vat) || 0
    out[key].count++
  }
  return out
}

/** Orders that are paid or delivered but have no invoice on file. */
export const missingPaperwork = (orders = []) => orders.filter(o =>
  !['draft', 'cancelled'].includes(o.status) && !o.invoice_path &&
  (o.payment_status === 'paid' || ['received', 'partially_received', 'completed'].includes(o.status)))

/** Money leaving in the next few weeks, for cash planning. */
export function dueSoon(orders = [], days = 30) {
  const limit = new Date(); limit.setDate(limit.getDate() + days)
  return orders.filter(o => awaitingPayment(o))
    .filter(o => o.terms !== 'credit' || !o.payment_due_at || new Date(o.payment_due_at) <= limit)
    .sort((a, b) => new Date(a.payment_due_at || 0) - new Date(b.payment_due_at || 0))
}

/** The same invoice number twice from one supplier usually means a double payment. */
export function duplicateInvoice(orders = [], po) {
  const n = String(po.invoice_number || '').trim().toLowerCase()
  if (!n) return null
  return orders.find(o => o.id !== po.id && o.supplier_id === po.supplier_id &&
    String(o.invoice_number || '').trim().toLowerCase() === n) || null
}

/** Credits raised against an order, and what they're worth. */
export function creditsFor(orders = [], po) {
  const list = orders.filter(o => isCredit(o) && o.credit_for === po?.id)
  return { list, total: list.reduce((s, c) => s + Math.abs(parseFloat(c.total) || 0), 0) }
}
