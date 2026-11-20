/**
 * What ⌘K can find.
 *
 * EVERY NEW MODULE MUST BE ADDED HERE when it's built. The registry below lists
 * each lockable section and how its records are searched; the test suite fails
 * if a section is missing from it, so a new feature can't quietly become
 * invisible to search.
 */
import { LOCKABLE, canAccess } from './access.js'
import { matchScore } from './match.js'

/**
 * How each section of the portal is searched. 'records' means its records are
 * indexed below; 'page' means the section has no records of its own and is
 * reachable by its name alone — say so deliberately rather than by omission.
 */
export const SEARCH_COVERAGE = {
  calculator: 'page',        // a workspace, nothing stored to find
  saved:      'records',     // saved listings
  approvals:  'page',        // the listings themselves are indexed under saved/live
  launch:     'page',        // approved listings; the listings are indexed under saved
  live:       'records',     // live listings
  hunter:     'records',     // hunts
  stock:      'records',     // products
  suppliers:  'records',     // companies, split across the three directories
  carriers:   'records',
  companies:  'records',
  brands:     'records',
  families:   'page',        // built from products, which are indexed
  shipping:   'page',
  packaging:  'records',   // packaging types, by name
  purchases:  'records',     // purchase orders and credit notes
  dispatch:   'records',     // batches, and the last 14 days of labels by order ref, postcode, customer or tracking
  'dispatch-dashboard': 'page', // figures only: found by its name
  requests:   'records',     // stock requests, by ref and product
  'goods-in': 'records',     // deliveries, by GI number, supplier, PO and delivery note
  inventory:  'records',     // stock products by name and HELM code, shelves by code; channel item codes are looked up (remoteItems)
  tasks:      'records',     // open tasks, by T number and product; finished ones by T number are looked up (remoteItems)
  offshore:   'page',        // open orders to remote postcodes: the page's own search (order, postcode, product)
  tracking:   'page',        // parcels: found from the page's own search
  'stock-planning': 'page',  // the page's own search
  'not-listed':     'page',
  'print-station':  'page',
  'order-audit':    'page',  // ANY order, however old, is looked up by its number, HELM number or tracking (remoteItems)  // the station and recent prints  // products with no live listing: the page's own search
  'customer-care':  'page',
  returns:          'page',  // returns by RT number or tracking, and cases by CP number, are looked up (remoteItems)  // complaints and returns: the page's own search
  claims:     'records',     // claims, by CL number, order ref, tracking and carrier ref
  payments:   'records',     // the same orders, reached from payments
  issues:     'page',        // reached from the order they belong to
  bulk:       'page',
  archive:    'page',
  settings:   'page',
}

/** Sections whose records must appear in the index built below. */
export const sectionsNeedingRecords = () =>
  LOCKABLE.filter(p => SEARCH_COVERAGE[p.id] === 'records').map(p => p.id)

const money = (n) => `£${(Math.abs(parseFloat(n) || 0)).toFixed(2)}`

/**
 * Everything findable, for this person. Anything they can't open is left out.
 */
export function buildSearchItems(ctx) {
  const {
    me, nav = [], listings = [], liveIds = new Set(), products = [], purchaseOrders = [],
    companies = [], hunts = [], directoryOf = () => 'suppliers', go, openPo,
  } = ctx
  const items = []

  for (const item of nav) {
    if (!canAccess(me, item.id)) continue
    items.push({ key: `page-${item.id}`, type: 'Page', label: item.label, hint: 'Go to page', icon: item.icon, action: () => go(item.id) })
  }

  for (const row of listings) {
    const live = liveIds.has(row.id)
    if (!canAccess(me, live ? 'live' : 'saved')) continue
    items.push({
      key: `listing-${row.id}`, type: live ? 'Live listing' : 'Saved listing', label: row.name,
      hint: [row.data?.listingSku, row.data?.channel && row.data.channel !== 'Amazon' ? row.data.channel : null, row.data?.asin, row.data?.itemId,
        ...(Array.isArray(row.data?.otherCodes) ? row.data.otherCodes.filter(c => c !== row.data?.itemId) : []), row.data?.brand, row.data?.supplierName].filter(Boolean).join(' · '),
      icon: live ? 'live' : 'bookmark', action: () => go(live ? 'live' : 'saved', row.id),
    })
  }

  if (canAccess(me, 'stock')) for (const row of products) {
    items.push({
      key: `stock-${row.id}`, type: 'Product', label: row.name,
      hint: [row.data?.sku, row.data?.supplierSku, row.data?.barcode, row.data?.supplierName].filter(Boolean).join(' · '),
      icon: 'package', action: () => go('stock', row.id),
    })
  }

  if (canAccess(me, 'purchases') || canAccess(me, 'payments')) for (const po of purchaseOrders) {
    const credit = po.kind === 'credit_note'
    items.push({
      key: `po-${po.id}`, type: credit ? 'Credit note' : 'Purchase order',
      label: `${po.po_number} · ${po.supplier_name || 'no supplier'}`,
      hint: [po.invoice_number && `invoice ${po.invoice_number}`, po.payment_reference, money(po.total),
             (po.items || []).map(i => i.name).join(', ')].filter(Boolean).join(' · ').slice(0, 140),
      icon: credit ? 'pound' : 'receipt',
      action: () => { go(canAccess(me, 'purchases') ? 'purchases' : 'payments', po.id); openPo?.(po.id) },
    })
  }

  for (const s of companies) {
    const dir = directoryOf(s)
    if (!canAccess(me, dir)) continue
    items.push({
      key: `company-${s.id}`,
      type: { suppliers: 'Supplier', carriers: 'Carrier', companies: 'Company' }[dir] || 'Company',
      label: s.name,
      hint: [s.data?.accountRef && `account ${s.data.accountRef}`, (s.data?.kinds || []).join(', ')].filter(Boolean).join(' · '),
      icon: dir === 'companies' ? 'briefcase' : 'truck', action: () => go(dir, s.id),
    })
  }

  if (canAccess(me, 'packaging')) for (const pk of ctx.packaging || []) {
    items.push({
      key: `packaging-${pk.id}`, type: 'Packaging', label: pk.name,
      hint: 'see and change what uses it', icon: 'box',
      action: () => go('packaging', pk.id),
    })
  }

  if (canAccess(me, 'dispatch')) {
    const { batches = [], labels = [], helm = [] } = ctx.dispatch || {}
    // HELM orders not through Dispatch yet: no label, or labelled and not uploaded
    const HELM_PHASE = { new: 'New order', labelled: 'Labelled, awaiting upload', backorder: 'Back order in HELM', hold: 'On hold in HELM' }
    for (const h of helm) {
      items.push({
        key: `helm-${h.id}`, type: HELM_PHASE[h.phase] || 'HELM order', label: h.ref || h.order_number || 'Order',
        hint: [h.order_number, h.channel, h.carrier].filter(Boolean).join(' · '),
        icon: 'inbox', action: () => go('dispatch', `helm:${h.id}`),
      })
    }
    const batchById = new Map(batches.map(b => [b.id, b]))
    for (const b of batches) {
      items.push({
        key: `dbatch-${b.id}`, type: 'Dispatch batch', label: `${b.code} · ${b.label_name}`,
        hint: [b.ship_date, b.carrier, b.service, `${b.label_count} labels`].filter(Boolean).join(' · '),
        icon: 'printer', action: () => go('dispatch', `batch:${b.id}`),
      })
    }
    for (const l of labels) {
      const b = batchById.get(l.batch_id)
      items.push({
        key: `dlabel-${l.id}`, type: 'Shipping label',
        label: [l.customer, l.postcode].filter(Boolean).join(' · ') || l.channel_ref || 'Label',
        hint: [l.label_name, l.channel_ref, l.helm_order, l.tracking, b && `${b.code} ${l.seq}/${b.label_count}`, l.status]
          .filter(Boolean).join(' · '),
        icon: 'printer', action: () => go('dispatch', `label:${l.id}`),
      })
    }
  }

  if (canAccess(me, 'claims')) for (const c of ctx.claims || []) {
    items.push({
      key: `claim-${c.id}`, type: 'Claim', label: `${c.ref} · ${c.order_ref || c.tracking || ''}`,
      hint: [c.tracking, c.carrier_ref, c.carrier, c.status === 'to_raise' ? 'to raise' : c.status].filter(Boolean).join(' · '),
      icon: 'receipt', action: () => go('claims', c.id),
    })
  }

  if (canAccess(me, 'requests')) for (const r of ctx.requests || []) {
    items.push({
      key: `request-${r.id}`, type: 'Stock request', label: `${r.ref} · ${r.product_name}`,
      hint: [r.raised_by && `asked by ${r.raised_by}`, r.progress?.po_number, r.progress?.supplier_name, r.note].filter(Boolean).join(' · ').slice(0, 140),
      icon: 'inbox', action: () => go('requests', r.id),
    })
  }

  if (canAccess(me, 'goods-in')) for (const d of ctx.deliveries || []) {
    items.push({
      key: `delivery-${d.id}`, type: d.kind === 'unexpected' ? 'Unexpected delivery' : 'Delivery',
      label: `${d.ref} · ${d.supplier_name || 'unknown supplier'}`,
      hint: [d.data?.po_number, d.delivery_note_no && `note ${d.delivery_note_no}`, d.received_by,
        new Date(d.received_at).toLocaleDateString('en-GB')].filter(Boolean).join(' · '),
      icon: 'package', action: () => go('goods-in', d.id),
    })
  }

  if (canAccess(me, 'inventory')) {
    for (const p of ctx.inventory?.products || []) {
      items.push({
        key: `inv-${p.id}`, type: 'Stock', label: p.name,
        hint: [p.code, `${Math.round(p.available)} available`, (p.locations || []).map(l => l.code).slice(0, 3).join(', ')].filter(Boolean).join(' · '),
        icon: 'box', action: () => go('inventory', p.id),
      })
    }
    for (const l of ctx.inventory?.locations || []) {
      items.push({
        key: `shelf-${l.code}`, type: 'Shelf', label: l.code, hint: l.pickable ? 'pick shelf' : 'overflow',
        icon: 'box', action: () => go('inventory', `shelf:${l.code}`),
      })
    }
  }

  if (canAccess(me, 'tasks')) for (const t of (ctx.inventory?.tasks || []).filter(x => x.status === 'open')) {
    items.push({
      key: `task-${t.id}`, type: 'Task', label: t.kind === 'count' ? `${t.ref} · count ${t.from_location}` : `${t.ref} · ${t.product_name}`,
      hint: t.kind === 'count' ? t.why : `move ${Math.round(t.qty)} from ${t.from_location} to ${t.to_location || 'a pick shelf'}`,
      icon: 'check', action: () => go('tasks', t.id),
    })
  }

  if (canAccess(me, 'hunter')) for (const h of hunts) {
    items.push({
      key: `hunt-${h.id}`, type: 'Hunt', label: h.name,
      hint: h.status === 'done' ? 'finished' : 'in progress', icon: 'search', action: () => go('hunter', h.id),
    })
  }

  if (canAccess(me, 'brands')) {
    for (const brand of [...new Set(listings.map(r => r.data?.brand).filter(Boolean))]) {
      items.push({
        key: `brand-${brand}`, type: 'Brand', label: brand, hint: 'everything from this brand',
        icon: 'tag', action: () => go('brands', encodeURIComponent(brand)),
      })
    }
  }

  return items
}

// ── Looked up in the database as you type (v2.98.0, migration 126) ─────────────────────────────────────────────────────
// The index above is built from what the portal already has in the browser. Older orders, orders with no label in the
// portal, channel item codes, returns, cases and finished tasks are not in it — and loading them all would slow the
// portal down. So when what is typed looks like a number or a code, ⌘K asks the database for just that.

/**
 * True when the text looks like an order number, tracking number, item code or one of our own references — worth
 * one lookup. Names and ordinary words never are, so typing a product's name asks the database nothing.
 */
export function looksLikeCode(q) {
  const t = String(q || '').trim()
  if (t.replace(/[^A-Za-z0-9]/g, '').length < 5) return false
  if (/\d{4,}/.test(t.replace(/[\s-]/g, ''))) return true          // four digits in a row (dashes and spaces aside)
  return !/\s/.test(t) && /\d/.test(t)                             // one word with a digit in it: RT-0021, SCOLA-PVAGLUE-5L
}

const dayShort = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}
const clip = (t, n = 60) => { const x = String(t || '').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x }

/** What the database lookup found, as ⌘K rows. Anything this person can't open is left out. */
export function remoteItems(res, { me, go }) {
  const items = []
  if (!res) return items
  if (canAccess(me, 'order-audit')) for (const o of res.orders || []) {
    const n = Number(o.labels) || 0
    const state = n > 0
      ? [o.dispatched_at ? `despatched ${dayShort(o.dispatched_at)}` : `label made ${dayShort(o.label_at)}`, n > 1 && `${n} labels`]
      : [o.sold && `sold ${dayShort(o.sold)}`, o.helm_open ? 'open in HELM, no label yet' : 'no label in the portal']
    items.push({
      key: `order-${o.ref}`, type: 'Order', label: o.ref, icon: 'search',
      hint: [o.channel, ...state, o.helm_closed === 'cancelled' && 'cancelled in HELM', o.pallet && 'pallet order',
        ...(o.returns || []).map(r => `return ${r}`), ...(o.cases || []).map(r => `case ${r}`), ...(o.claims || []).map(r => `claim ${r}`),
        clip(o.what)].filter(Boolean).join(' · '),
      action: () => go('order-audit', o.ref),
    })
  }
  if (canAccess(me, 'returns')) for (const r of res.returns || []) {
    items.push({
      key: `return-${r.ref}`, type: 'Return', label: [r.ref, r.order_ref].filter(Boolean).join(' · '), icon: 'inbox',
      hint: [String(r.status || '').replace(/_/g, ' '), dayShort(r.at)].filter(Boolean).join(' · '), action: () => go('returns', r.ref),
    })
  }
  if (canAccess(me, 'customer-care')) for (const c of res.cases || []) {
    items.push({
      key: `case-${c.ref}`, type: 'Case', label: [c.ref, c.order_ref].filter(Boolean).join(' · '), icon: 'review',
      hint: [clip(c.product, 50), c.status, dayShort(c.at)].filter(Boolean).join(' · '), action: () => go('customer-care', c.ref),
    })
  }
  if (canAccess(me, 'inventory')) for (const c of res.codes || []) {
    const its = (c.items || []).filter(i => i.name || i.code)
    items.push({
      key: `code-${c.sku}`, type: 'Item code', label: [c.sku, clip(c.title, 50)].filter(Boolean).join(' · '), icon: 'swap',
      hint: its.length ? `sends ${its.map(i => `${Number(i.qty) || 1} × ${i.name || i.code}`).join(' + ')}` : 'not linked to a product yet',
      action: () => go('inventory', its.length === 1 ? its[0].product_id : undefined),
    })
  }
  if (canAccess(me, 'tasks')) for (const t of res.tasks || []) {
    items.push({
      key: `task-${t.id}`, type: `Task (${String(t.status || 'closed').replace(/_/g, ' ')})`,
      label: t.kind === 'count' ? `${t.ref} · count ${t.from || ''}` : `${t.ref} · ${t.product || ''}`, icon: 'check',
      hint: [t.kind !== 'count' && t.qty != null && `move ${Math.round(t.qty)} from ${t.from || '?'} to ${t.to || 'a pick shelf'}`,
        t.done_at && `${dayShort(t.done_at)}${t.done_by ? ` by ${t.done_by}` : ''}`].filter(Boolean).join(' · '),
      action: () => go('tasks', t.id),
    })
  }
  return items
}

/** The looked-up rows first (they are exact), then the usual matches; nothing listed twice. Looked-up rows may run to
 *  two lines (`wrap`) so a return, case or claim on an order is never cut off. */
export function withRemote(local = [], remote = [], limit = 20) {
  const seen = new Set(remote.map(i => i.key))
  return remote.map(i => ({ ...i, wrap: true })).concat(local.filter(i => !seen.has(i.key))).slice(0, limit)
}

/** Matches, closest first, with pages ahead of records. */
export function searchItems(items, query, limit = 12) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return items.filter(i => i.type === 'Page').slice(0, limit)
  // Keywords in any order, closest first; pages ahead of records when they match as well
  const scored = items.map(i => ({ i, m: matchScore(`${i.label} ${i.hint} ${i.type}`, q), l: matchScore(i.label, q) })).filter(x => x.m.hits)
  const full = scored.filter(x => x.m.all)
  const pool = full.length >= Math.min(limit, 5) ? full : full.concat(scored.filter(x => !x.m.all && x.m.hits / x.m.of >= 0.5))
  return pool
    .sort((a, b) => (b.m.all - a.m.all) || (b.i.type === 'Page' && b.l.all) - (a.i.type === 'Page' && a.l.all) || (b.l.score + b.m.score) - (a.l.score + a.m.score))
    .slice(0, limit)
    .map(x => x.i)
}
