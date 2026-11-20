/**
 * One-time migration: derive products from existing listings and link them.
 *
 * Grouping key, in order of preference:
 *   1. Supplier SKU (most reliable — already used consistently)
 *   2. Normalised product name + supplier (for listings with no SKU)
 *
 * A listing's unit cost is its Cost Per Item for bundles, or Cost Price for singles.
 * Where the same key shows different unit costs, the most common value wins and
 * the conflict is reported so it can be corrected afterwards.
 */

const PACK_SUFFIX = /\s*[-–]\s*(pack|set)\s+of\s+\d+\s*$/i
const MULTI_SKU = /\s*\+\s*/

export function normaliseName(name) {
  return (name || '').replace(PACK_SUFFIX, '').trim()
}

function unitCost(p) {
  const q = parseInt(p.bundleQty) || 1
  return q > 1
    ? (parseFloat(p.costPerItem) || 0)
    : (parseFloat(p.costPrice) || 0)
}

function unitWeight(p) {
  const q = parseInt(p.bundleQty) || 1
  if (q > 1) {
    if (p.weightPerItem) return parseFloat(p.weightPerItem) || 0
    // Weight was stored as a total — divide it back out
    return (parseFloat(p.weightKg) || 0) / q
  }
  return parseFloat(p.weightKg) || 0
}

function mode(values) {
  const counts = new Map()
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1))
  let best = values[0], bestN = 0
  counts.forEach((n, v) => { if (n > bestN) { bestN = n; best = v } })
  return best
}

/**
 * Plans the migration without writing anything.
 * Returns { stockItems, links, conflicts, mixed, unlinkable }
 */
export function planMigration(savedProducts) {
  const groups = new Map()   // key -> { key, sku, name, supplier, rows: [] }
  const mixed = []           // listings whose SKU names several products
  const unlinkable = []

  savedProducts.forEach(row => {
    const p = row.data || {}
    const sku = (p.supplierSku || '').trim()

    // A SKU containing "+" describes a mixed bundle — handled separately
    if (sku && MULTI_SKU.test(sku)) {
      mixed.push({ row, p, skus: sku.split(MULTI_SKU).map(s => s.trim()).filter(Boolean) })
      return
    }

    const key = sku
      ? `sku:${sku.toLowerCase()}`
      : `name:${normaliseName(p.name || row.name).toLowerCase()}|${(p.supplierName || '').toLowerCase()}`

    if (!key || key === 'name:|') { unlinkable.push({ row, p }); return }

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        sku,
        name: normaliseName(p.name || row.name),
        supplier: p.supplierName || '',
        brand: p.brand || '',
        rows: [],
      })
    }
    groups.get(key).rows.push({ row, p })
  })

  const conflicts = []
  const stockItems = []
  const links = []

  groups.forEach(g => {
    const costs = g.rows.map(r => unitCost(r.p)).filter(c => c > 0)
    const weights = g.rows.map(r => unitWeight(r.p)).filter(w => w > 0)

    const cost = costs.length ? mode(costs.map(c => Number(c.toFixed(4)))) : 0
    const weight = weights.length ? mode(weights.map(w => Number(w.toFixed(4)))) : 0

    const distinctCosts = [...new Set(costs.map(c => Number(c.toFixed(4))))]
    if (distinctCosts.length > 1) {
      conflicts.push({
        name: g.name,
        sku: g.sku,
        field: 'cost',
        values: distinctCosts.sort((a, b) => a - b),
        chosen: cost,
        listings: g.rows.map(r => r.row.name),
      })
    }

    const distinctWeights = [...new Set(weights.map(w => Number(w.toFixed(4))))]
    if (distinctWeights.length > 1) {
      conflicts.push({
        name: g.name,
        sku: g.sku,
        field: 'weight',
        values: distinctWeights.sort((a, b) => a - b),
        chosen: weight,
        listings: g.rows.map(r => r.row.name),
      })
    }

    const stock = {
      _key: g.key,
      name: g.name,
      brand: g.brand,
      supplierName: g.supplier,
      supplierSku: g.sku,
      costPrice: String(cost),
      weightKg: String(weight),
      notes: '',
    }
    stockItems.push(stock)

    g.rows.forEach(({ row, p }) => {
      links.push({
        productId: row.id,
        productName: row.name,
        components: [{ _key: g.key, qty: parseInt(p.bundleQty) || 1 }],
      })
    })
  })

  // Mixed bundles: link each named SKU, one unit of each unless stated
  mixed.forEach(({ row, p, skus }) => {
    const comps = skus.map(s => ({ _key: `sku:${s.toLowerCase()}`, qty: 1 }))
    const allFound = comps.every(c => groups.has(c._key))
    if (allFound) {
      links.push({
        productId: row.id,
        productName: row.name,
        components: comps,
        isMixed: true,
      })
    } else {
      unlinkable.push({ row, p, reason: 'Mixed bundle referencing an unknown SKU' })
    }
  })

  return { stockItems, links, conflicts, mixed, unlinkable }
}
