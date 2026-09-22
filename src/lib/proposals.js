/**
 * Works out what *should* change on existing products, without changing
 * anything. Every result is a proposal for the approval queue.
 */
import { PLAIN_RATES, DIGITAL_SERVICES_FEE } from './feeSchedule.js'

const low = (s) => String(s || '').trim().toLowerCase()

/** Which supplier profile a product belongs to, via its supplier name. */
export function supplierForName(name, suppliers) {
  const n = low(name)
  if (!n) return null
  return suppliers.find(s =>
    low(s.name) === n || (s.data?.aliases || []).some(a => low(a) === n)) || null
}

// ── Referral fees missing the 2% digital services fee ─────────────────────────
export function feeProposals(liveRows) {
  const out = []
  for (const { saved } of liveRows) {
    const p = saved.data || {}
    if (p.feeCategory) continue                     // category-based fees already include it
    const rate = parseFloat(p.refFee)
    if (!PLAIN_RATES.includes(rate)) continue       // already adjusted, or unusual
    const to = +(rate * (1 + DIGITAL_SERVICES_FEE)).toFixed(2)
    out.push({
      kind: 'referral_fee', target_type: 'saved_product', target_id: saved.id,
      payload: { from: rate, to, listing: saved.name },
      reason: `Amazon adds a 2% digital services fee to every referral fee for UK sellers — ${rate}% is really ${to}%`,
      dedupe_key: `fee-dsf:${saved.id}:${rate}`,
    })
  }
  return out
}

// ── From a newly imported price list ─────────────────────────────────────────
export function listProposals({ supplier, rows, listDate, stockItems }) {
  const out = []
  const bySku = new Map(rows.map(r => [low(r.sku), r]))
  const byBarcode = new Map(rows.filter(r => r.barcode).map(r => [r.barcode, r]))

  const mine = stockItems.filter(si => {
    const d = si.data || {}
    const n = low(d.supplierName)
    return n && (low(supplier.name) === n || (supplier.data?.aliases || []).some(a => low(a) === n))
  })

  for (const si of mine) {
    const d = si.data || {}
    const row = (d.supplierSku && bySku.get(low(d.supplierSku))) || (d.barcode && byBarcode.get(d.barcode))
    if (!row) continue

    if (row.barcode && !d.barcode) {
      out.push({
        kind: 'barcode', target_type: 'stock_item', target_id: si.id,
        payload: { to: row.barcode, stockItem: si.name, supplier: supplier.name, sku: row.sku },
        reason: `Matched to ${supplier.name}'s list by supplier SKU ${row.sku}`,
        dedupe_key: `barcode:${si.id}:${row.barcode}`,
      })
    }

    const current = parseFloat(d.costPrice) || 0
    if (row.unitCost !== null && Math.abs(row.unitCost - current) >= 0.01) {
      out.push({
        kind: 'cost', target_type: 'stock_item', target_id: si.id,
        payload: { from: current, to: +row.unitCost.toFixed(4), stockItem: si.name,
                   supplier: supplier.name, sku: row.sku, listDate },
        reason: row.data?.source === 'online'
          ? `${supplier.name}'s website shows ${row.data.caseSize > 1 ? `£${Number(row.data.shownPrice).toFixed(2)} for a case of ${row.data.caseSize}` : `£${Number(row.data.shownPrice ?? row.unitCost).toFixed(2)}`}${row.data.vatIncluded ? ' including VAT' : ''} — £${row.unitCost.toFixed(2)} each ex-VAT`
          : `${supplier.name}'s price list${listDate ? ` dated ${listDate}` : ''} shows a different unit cost`,
        dedupe_key: `cost:${si.id}:${row.unitCost.toFixed(4)}`,
      })
    }

    const status = row.data?.status || ''
    if (/DISCONTINUED|WHILE STOCKS LAST|UNAVAILABLE/.test(status)) {
      out.push({
        kind: 'lifecycle', target_type: 'stock_item', target_id: si.id,
        payload: { status, replacement: row.data?.replacement || null, stockItem: si.name, supplier: supplier.name, sku: row.sku },
        reason: row.data?.replacement
          ? `${supplier.name} lists this as "${status.toLowerCase()}", replaced by ${row.data.replacement}`
          : `${supplier.name} lists this as "${status.toLowerCase()}"`,
        dedupe_key: `life:${si.id}:${status}`,
      })
    }
  }
  return out
}

// ── The same product available cheaper elsewhere ──────────────────────────────
export function cheaperSupplierProposals({ stockItems, supplierProducts, suppliers }) {
  const out = []
  const byBarcode = new Map()
  for (const sp of supplierProducts) {
    if (!sp.barcode || sp.unit_cost === null || sp.unit_cost <= 0) continue
    if (sp.data?.excluded) continue
    if (/DISCONTINUED - NO STOCK/.test(sp.data?.status || '')) continue
    if (!byBarcode.has(sp.barcode)) byBarcode.set(sp.barcode, [])
    byBarcode.get(sp.barcode).push(sp)
  }
  const supName = (id) => suppliers.find(s => s.id === id)?.name || 'another supplier'

  for (const si of stockItems) {
    const d = si.data || {}
    if (!d.barcode) continue
    const current = parseFloat(d.costPrice) || 0
    if (!(current > 0)) continue
    const mySupplier = supplierForName(d.supplierName, suppliers)
    const offers = (byBarcode.get(d.barcode) || [])
      .filter(o => o.supplier_id !== mySupplier?.id)
      .filter(o => !(o.data?.stock === 0))
      .sort((a, b) => a.unit_cost - b.unit_cost)
    const best = offers[0]
    if (!best || best.unit_cost > current - 0.01) continue

    const gap = (current - best.unit_cost) / current * 100
    out.push({
      kind: 'cheaper_supplier', target_type: 'stock_item', target_id: si.id,
      payload: {
        stockItem: si.name, fromSupplier: d.supplierName || null, from: current,
        toSupplierId: best.supplier_id, toSupplier: supName(best.supplier_id),
        toSku: best.supplier_sku, to: +Number(best.unit_cost).toFixed(4),
        gapPct: +gap.toFixed(1), checkFirst: gap > 40,
        stock: best.data?.stock ?? null, listDate: best.list_date,
      },
      reason: gap > 40
        ? `${supName(best.supplier_id)} is ${gap.toFixed(0)}% cheaper — a gap this large is worth checking before switching (short-dated stock or a pricing error)`
        : `${supName(best.supplier_id)} is ${gap.toFixed(0)}% cheaper on the same barcode`,
      dedupe_key: `cheaper:${si.id}:${best.supplier_id}:${Number(best.unit_cost).toFixed(4)}`,
    })
  }
  return out
}

/** Stored catalogue rows in the shape the proposal checks expect. */
export function rowsFromCatalogue(supplierProducts, supplierId) {
  return supplierProducts
    .filter(sp => sp.supplier_id === supplierId && sp.unit_cost !== null)
    .map(sp => ({ sku: sp.supplier_sku, barcode: sp.barcode, unitCost: Number(sp.unit_cost), name: sp.name, data: sp.data || {} }))
}

/** A cheaper carrier found by the shipping review — proposed, never applied directly. */
export function carrierProposals(items, carriers) {
  return items.map(({ saved, s }) => ({
    kind: 'carrier', target_type: 'saved_product', target_id: saved.id,
    payload: {
      listing: saved.name, from: s.currentName, fromRate: s.currentRate,
      toCarrierId: s.best.carrierId, toCatId: s.best.catId,
      to: `${s.best.carrierName} — ${s.best.catName}`, toRate: s.best.rate, saving: +(s.currentRate - s.best.rate).toFixed(2),
    },
    reason: `${s.best.carrierName} is ${(s.currentRate - s.best.rate).toFixed(2)} cheaper per parcel for this weight and service`,
    dedupe_key: `carrier:${saved.id}:${s.best.carrierId}:${s.best.catId}:${s.best.rate}`,
  }))
}
