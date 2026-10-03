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
  purchases:  'records',     // purchase orders and credit notes
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
