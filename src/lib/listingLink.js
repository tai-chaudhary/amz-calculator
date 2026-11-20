// Listings built before Products existed carry their own cost, supplier SKU and weight. Each one is linked to
// the Product it sells (one Product → many listings: 1x, 2x, 4x…). Listings of the same product are grouped
// (same supplier SKU, or same product name and supplier) so they're linked together, to an EXISTING Product
// wherever there is one — a new Products entry only when there's genuinely nothing to link to.
import { hasComponents } from './calc.js'
import { compareNames } from './productLink.js'

const MULTI_SKU = /\s*\+\s*/
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The product a listing sells, without the listing's pack wording: "2 x Jungle Formula …" → "Jungle Formula …" */
export function productNameOf(listingName) {
  return String(listingName || '')
    .replace(/^\s*\d+\s*[x×]\s+/i, '')
    .replace(/\s*[-–(]\s*(pack|set|bundle)\s+of\s+\d+\s*\)?\s*$/i, '')
    .replace(/\s*\(\s*\d+\s*(pack|pk)\s*\)\s*$/i, '')
    .replace(/\s{2,}/g, ' ').trim()
}

// How many of the product a listing sends: its bundle quantity, or "3x …" / "… Pack of 3" in its name
export const qtyOf = (p) => {
  const q = parseInt(p.bundleQty, 10)
  if (q > 0) return q
  const n = String(p.name || '').match(/^\s*(\d+)\s*[x×]\s/i) || String(p.name || '').match(/pack of (\d+)\s*\)?\s*$/i)
  return n ? Math.max(1, +n[1]) : 1
}
/** Per unit, as the Product holds it: a bundle's cost per item, or a single's cost price */
export const unitCost = (p) => (qtyOf(p) > 1 ? parseFloat(p.costPerItem) || 0 : parseFloat(p.costPrice) || 0)
export const unitWeight = (p) => (qtyOf(p) > 1 ? (parseFloat(p.weightPerItem) || (parseFloat(p.weightKg) || 0) / qtyOf(p)) : parseFloat(p.weightKg) || 0)

function mostCommon(values) {
  const m = new Map(); values.forEach(v => m.set(v, (m.get(v) || 0) + 1))
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}

/**
 * Listings not linked to a Product, grouped. Each group: { key, name, sku, supplier, brand, cost, weight,
 * costs (all different values seen), weights, rows: [{ row, p, qty }], parts (mixed bundles: one per SKU) }
 */
export function groupListings(savedProducts = []) {
  const groups = new Map()
  const mixed = []
  for (const row of savedProducts) {
    const p = row.data || {}
    if (p.archived || hasComponents(p)) continue
    const sku = (p.supplierSku || '').trim()
    if (sku && MULTI_SKU.test(sku)) {
      mixed.push({ key: `mix:${row.id}`, mixed: true, name: row.name, supplier: p.supplierName || '', brand: p.brand || '',
        rows: [{ row, p, qty: 1 }], parts: sku.split(MULTI_SKU).map(s => s.trim()).filter(Boolean).map(s => ({ sku: s, qty: 1 })) })
      continue
    }
    const name = productNameOf(p.name || row.name)
    const key = sku ? `sku:${norm(sku)}` : `name:${norm(name)}|${norm(p.supplierName)}`
    if (!groups.has(key)) groups.set(key, { key, name, sku, supplier: p.supplierName || '', brand: p.brand || '', rows: [] })
    groups.get(key).rows.push({ row, p, qty: qtyOf({ ...p, name: p.name || row.name }) })
  }
  const out = [...groups.values()].map(g => {
    const costs = [...new Set(g.rows.map(r => +unitCost(r.p).toFixed(4)).filter(c => c > 0))]
    const weights = [...new Set(g.rows.map(r => +unitWeight(r.p).toFixed(4)).filter(w => w > 0))]
    // The single (1x) listing's name is the best guess at the product's own name
    const single = g.rows.find(r => r.qty === 1)
    return {
      ...g, name: productNameOf(single ? (single.p.name || single.row.name) : g.name),
      cost: costs.length ? mostCommon(g.rows.map(r => +unitCost(r.p).toFixed(4)).filter(c => c > 0)) : 0,
      weight: weights.length ? mostCommon(g.rows.map(r => +unitWeight(r.p).toFixed(4)).filter(w => w > 0)) : 0,
      costs, weights,
      rows: g.rows.sort((a, b) => a.qty - b.qty),
    }
  })
  return [...out.sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)), ...mixed]
}

/**
 * Which existing Product a group sells, best first: the same supplier SKU is a clear match; otherwise the
 * same words and size (a "2 rolls" product never matches "12 rolls"), helped a little by the same supplier.
 */
export function suggestProducts(group, stockItems = [], { sku = group.sku, name = group.name } = {}) {
  const live = stockItems.filter(si => !si.data?.archived)
  const bySku = sku ? live.filter(si => norm(si.data?.supplierSku) && norm(si.data?.supplierSku) === norm(sku)) : []
  const scored = live.map(si => {
    const a = compareNames(name, si.name)
    const b = si.data?.supplierProductName ? compareNames(name, si.data.supplierProductName) : { score: 0, sizes: 'unknown' }
    const best = b.score > a.score ? b : a
    const sameSupplier = group.supplier && norm(si.data?.supplierName) === norm(group.supplier)
    return { si, score: Math.min(1, best.score + (sameSupplier ? 0.1 : 0)), sizes: best.sizes, bySku: bySku.includes(si) }
  })
  const ranked = scored.filter(x => x.bySku || x.score >= 0.4).sort((x, y) => (y.bySku - x.bySku) || (y.score - x.score)).slice(0, 4)
  const first = ranked[0]
  const confident = !!first && (first.bySku ? bySku.length === 1 : first.score >= 0.8 && first.sizes === 'same')
  return { options: ranked, confident }
}
