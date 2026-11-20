/**
 * Each product's "packaging when sent on its own", dated (migration 136, table product_packaging), and the rule that
 * costs a website order with it.
 *
 * The owner's rule (18 Nov 2026): a Plenty&More or Salt 4 U order has no listing; the warehouse picks the box that
 * fits. The portal costs it as **the biggest item decides the box**: the dearest of the order's products' own
 * packaging, once for each real parcel. The other products ride in the same box.
 *
 * rows: [{ id, stock_item_id, from_date, packaging_id, own }]. The row in force on a day is the latest dated on or
 * before it; a wrong row is removed, never edited.
 */
import { isWebsite } from './channels.js'
export const isWebsiteChannel = isWebsite

const newest = (a, b) => String(b.from_date).localeCompare(String(a.from_date)) || (b.id || 0) - (a.id || 0)

/** Map(stock item id → its rows, newest first) */
export function groupProductPackaging(rows) {
  const m = new Map()
  for (const r of rows || []) (m.get(r.stock_item_id) || m.set(r.stock_item_id, []).get(r.stock_item_id)).push(r)
  for (const list of m.values()) list.sort(newest)
  return m
}

/** The product's packaging in force on a day, or null when it has none by then */
export function packagingOn(rows, stockItemId, day) {
  const mine = rows instanceof Map ? rows.get(stockItemId) || [] : (rows || []).filter(r => r.stock_item_id === stockItemId).sort(newest)
  return mine.find(r => String(r.from_date) <= String(day)) || null
}

/**
 * The packaging of one parcel of a basket: the dearest of its products' own packaging.
 * productIds: the stock items in the order. costOf(packagingId) → the type's cost, or null when the type is gone.
 * Returns { known, cost, productId, packagingId, own, missing: [ids with no packaging set] }.
 * known is false when none of the products has a packaging: the basket is then costed with none and counted as such.
 */
export function basketPackaging({ productIds = [], rows, day, costOf }) {
  const out = { known: false, cost: 0, productId: null, packagingId: null, own: false, missing: [] }
  for (const id of new Set(productIds)) {
    const r = packagingOn(rows, id, day)
    const cost = !r ? null : r.own ? 0 : costOf(r.packaging_id)
    if (cost == null) { out.missing.push(id); continue }
    if (!out.known || cost > out.cost) Object.assign(out, { known: true, cost, productId: id, packagingId: r.own ? null : r.packaging_id, own: !!r.own })
  }
  return out
}

/** Which of a product's rows is in force today and which are to come: Map(id → 'current' | 'to come' | 'earlier') */
export function packagingStates(rows, day) {
  const cur = (rows || []).slice().sort(newest).find(r => String(r.from_date) <= String(day))
  return new Map((rows || []).map(r => [r.id, String(r.from_date) > String(day) ? 'to come' : cur && r.id === cur.id ? 'current' : 'earlier']))
}
