// Packaging types (Settings → packaging) are what a listing ships in. Each type is made of real packaging
// items — Products entries marked as packaging — with quantities, plus an optional untracked extra (tape,
// void fill). Its cost and weight are worked out from those items, never typed in, so changing a box for a
// cheaper one changes every listing that uses the type. Types not built yet keep their old typed-in cost.

const num = (v) => parseFloat(v) || 0

/** Is this Products entry a packaging item? (alsoSold: it's on Products too, as something we sell) */
export const isPackaging = (si) => !!si?.data?.packaging
export const packagingOnly = (si) => isPackaging(si) && !si?.data?.alsoSold

/** Cost of one unit: pack price ÷ units per pack when bought in packs, else the unit cost */
export function unitCost(si) {
  const d = si?.data || {}
  const units = num(d.packUnits)
  if (units > 1 && num(d.packPrice) > 0) return num(d.packPrice) / units
  return num(d.costPrice)
}

export const isBuilt = (pk) => Array.isArray(pk?.components) && pk.components.length > 0

/** What a type is made of, resolved: [{ si, qty, unit, line }] (missing items are kept, flagged) */
export function partsOf(pk, stockItems = []) {
  return (pk?.components || []).map(c => {
    const si = stockItems.find(x => x.id === c.stockItemId) || null
    const qty = num(c.qty) || 1
    const unit = si ? unitCost(si) : 0
    return { stockItemId: c.stockItemId, si, qty, unit, line: unit * qty, missing: !si }
  })
}

/** A type's cost per parcel: its items plus the extra (when ticked); a type not built yet keeps its typed cost */
export function typeCost(pk, stockItems = []) {
  if (!isBuilt(pk)) return num(pk?.cost)
  const parts = partsOf(pk, stockItems)
  return parts.reduce((s, p) => s + p.line, 0) + (pk.extraOn ? num(pk.extraCost) : 0)
}

/** A type's weight: its items' weights (where known), or the weight typed on the type */
export function typeWeight(pk, stockItems = []) {
  if (!isBuilt(pk)) return num(pk?.weightKg)
  const parts = partsOf(pk, stockItems)
  const known = parts.reduce((s, p) => s + num(p.si?.data?.weightKg) * p.qty, 0)
  return known > 0 ? known : num(pk?.weightKg)
}

/** Settings with every packaging type's cost and weight worked out from its items (what everything reads) */
export function resolvePackaging(settings, stockItems = []) {
  if (!settings?.packaging) return settings
  return {
    ...settings,
    packaging: settings.packaging.map(pk => (isBuilt(pk)
      ? { ...pk, cost: +typeCost(pk, stockItems).toFixed(4), weightKg: +typeWeight(pk, stockItems).toFixed(4) }
      : pk)),
  }
}

/** Where a packaging item is used: types, the listings on them, and the products those listings sell */
export function usageOf(si, packaging = [], savedProducts = [], stockItems = []) {
  const types = packaging.filter(pk => (pk.components || []).some(c => c.stockItemId === si.id))
  const ids = new Set(types.map(t => t.id))
  const listings = savedProducts.filter(r => !r.data?.archived && ids.has(r.data?.packagingId))
  const productIds = new Set(listings.flatMap(r => (r.data?.components || []).map(c => c.stockItemId)))
  const products = stockItems.filter(x => productIds.has(x.id))
  return { types, listings, products }
}

// Bought in packs (Kite sells mailers in 100s): POs are in packs at the pack price, stock is in units
export const packUnitsOf = (si) => { const n = num(si?.data?.packUnits); return n > 1 ? n : 1 }
/** What one PO line unit costs: the pack price when it's bought in packs, else the unit cost */
export const poUnitCost = (si) => (packUnitsOf(si) > 1 && num(si?.data?.packPrice) > 0 ? num(si.data.packPrice) : num(si?.data?.costPrice))
/** Units wanted → packs to order (rounded up) */
export const packsFor = (si, units) => Math.max(1, Math.ceil(num(units) / packUnitsOf(si)))
/** The unit a cost is "per": each, metre, quilt… */
export const unitLabel = (si) => si?.data?.unitName && si.data.unitName !== 'each' ? si.data.unitName : 'each'

/**
 * Tape for a box, cross on top and cross on the bottom: a strip along the length and one across the width,
 * each running `overhang` mm over the edge at both ends. Metres.
 */
export function tapeMetres(dims, overhang = 50) {
  const l = num(dims?.l); const w = num(dims?.w)
  if (!(l > 0 && w > 0)) return 0
  return +((2 * (l + w) + 8 * overhang) / 1000).toFixed(3)
}

const supKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
/** Same supplier? Exact, or one name starting with the other ("Pricecheck" / "Pricecheck Brand Partners") — as the database */
export function sameSupplier(a, b) {
  const x = supKey(a); const y = supKey(b)
  if (!x || !y) return false
  return x === y || (x.length >= 5 && y.length >= 5 && (x.startsWith(y) || y.startsWith(x)))
}

/**
 * What a PO line for this product costs from this supplier: their code, pack size and last price when we've
 * bought it from them (data.suppliers), else the product's own when it's its supplier. known = false: a supplier
 * we've not bought it from — no price yet.
 */
export function supplierTermsFor(si, supplierName) {
  const d = si?.data || {}
  const e = (Array.isArray(d.suppliers) ? d.suppliers : []).find(x => sameSupplier(x.name, supplierName))
  if (e) {
    const packUnits = Math.max(1, num(e.packUnits) || 1)
    const price = packUnits > 1 ? num(e.lastPackPrice) || num(e.packPrice) : num(e.lastPrice) || num(e.costPrice)
    return { known: true, supplierSku: e.supplierSku || '', packUnits, price: +price.toFixed(4) }
  }
  if (!supplierName || sameSupplier(d.supplierName, supplierName)) {
    return { known: true, supplierSku: d.supplierSku || '', packUnits: packUnitsOf(si), price: poUnitCost(si) }
  }
  return { known: false, supplierSku: '', packUnits: 1, price: 0 }
}
