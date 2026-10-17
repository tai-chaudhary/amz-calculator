/**
 * What ⌘K can find.
 *
 * EVERY NEW MODULE MUST BE ADDED HERE when it's built. The registry below lists
 * each lockable section and how its records are searched; the test suite fails
 * if a section is missing from it, so a new feature can't quietly become
 * invisible to search.
 */
import { LOCKABLE, canAccess } from './access.js'

/**
 * How each section of the portal is searched. 'records' means its records are
 * indexed below; 'page' means the section has no records of its own and is
 * reachable by its name alone — say so deliberately rather than by omission.
 */
export const SEARCH_COVERAGE = {
  calculator: 'page',        // a workspace, nothing stored to find
  saved:      'records',     // saved listings
  approvals:  'page',        // the listings themselves are indexed under saved/live
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
  dispatch:   'records',     // batches, and labels by order ref, postcode, customer or tracking
  'dispatch-dashboard': 'page', // figures only: found by its name
  requests:   'records',     // stock requests, by ref and product
  'goods-in': 'records',     // deliveries, by GI number, supplier, PO and delivery note
  inventory:  'records',     // stock products by name and HELM code, and shelves by code
  tasks:      'records',     // open tasks, by T number and product
  payments:   'records',     // the same orders, reached from payments
  issues:     'page',        // reached from the order they belong to
  buildmonth: 'page',
  overheads:  'page',
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
      hint: [row.data?.asin, row.data?.brand, row.data?.supplierName].filter(Boolean).join(' · '),
      icon: live ? 'live' : 'bookmark', action: () => go(live ? 'live' : 'saved', row.id),
    })
  }

  if (canAccess(me, 'stock')) for (const row of products) {
    items.push({
      key: `stock-${row.id}`, type: 'Product', label: row.name,
      hint: [row.data?.supplierSku, row.data?.barcode, row.data?.supplierName].filter(Boolean).join(' · '),
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

/** Matches, closest first, with pages ahead of records. */
export function searchItems(items, query, limit = 12) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return items.filter(i => i.type === 'Page').slice(0, limit)
  const at = (s) => { const i = String(s).toLowerCase().indexOf(q); return i < 0 ? 99 : i }
  return items
    .filter(i => `${i.label} ${i.hint} ${i.type}`.toLowerCase().includes(q))
    .sort((a, b) => (b.type === 'Page') - (a.type === 'Page') || at(a.label) - at(b.label))
    .slice(0, limit)
}
