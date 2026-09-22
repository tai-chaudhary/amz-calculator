import { findFeeCategory, referralFeeFor, thresholdsFor } from './feeSchedule.js'
// A missing number shows as a dash, never as £0.00 — zero is a real value
const missing = (n) => n === null || n === undefined || !Number.isFinite(Number(n))

export function fmt(n) {
  if (missing(n)) return '—'
  return '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtSigned(n) {
  if (missing(n)) return '—'
  return (n < 0 ? '-' : '') + fmt(n)
}

export function pct(n) {
  if (missing(n)) return '—'
  return Number(n).toFixed(1) + '%'
}

/**
 * A listing's components: [{ stockItemId, qty }].
 * Empty or missing means the listing carries its own cost/weight (unlinked).
 */
export function hasComponents(p) {
  return Array.isArray(p.components) && p.components.length > 0
}

/**
 * Anything that makes a listing's numbers untrustworthy. A missing product
 * or an unset rate must never be treated as £0 — that makes a listing look
 * more profitable than it is. Any issue marks the calculation incomplete.
 */
export function calcIssues(p, carriers, stockItems = [], packaging = null) {
  const issues = []
  if (hasComponents(p) && !p.costOverride) {
    for (const c of p.components) {
      const si = stockItems.find(s => s.id === c.stockItemId)
      if (!si) { issues.push({ kind: 'missing-component', text: 'Links to a product that no longer exists' }); continue }
      const cost = parseFloat(si.data?.costPrice ?? si.costPrice)
      if (!(cost > 0)) issues.push({ kind: 'no-cost', text: `"${si.name}" has no cost` })
    }
  } else {
    const bundleQty = parseInt(p.bundleQty) || 1
    const cost = bundleQty > 1 ? parseFloat(p.costPerItem) : parseFloat(p.costPrice)
    if (!(cost > 0)) issues.push({ kind: 'no-cost', text: 'No product cost entered' })
  }
  if (p.carrierId && p.carrierCatId && p.serviceLevel) {
    const carrier = carriers?.[p.carrierId]
    const cat = carrier?.categories?.find(c => c.id === p.carrierCatId)
    if (!carrier || !cat) issues.push({ kind: 'no-carrier', text: 'Carrier or weight band no longer exists' })
    else if (!(cat.rates?.[p.serviceLevel] > 0)) issues.push({ kind: 'no-rate', text: `${carrier.name} has no ${p.serviceLevel} rate set` })
  } else {
    issues.push({ kind: 'no-shipping', text: 'No carrier chosen' })
  }
  if (p.packagingId && packaging && !packaging.find(x => x.id === p.packagingId)) {
    issues.push({ kind: 'no-packaging', text: 'Its packaging has been deleted' })
  }
  return issues
}

/** Resolve a listing's total cost from its linked products. */
export function componentCost(p, stockItems = []) {
  if (!hasComponents(p)) return null
  return p.components.reduce((sum, c) => {
    const si = stockItems.find(s => s.id === c.stockItemId)
    const cost = parseFloat(si?.data?.costPrice ?? si?.costPrice) || 0
    return sum + cost * (parseInt(c.qty) || 0)
  }, 0)
}

/** Resolve a listing's total weight from its linked products. */
export function componentWeight(p, stockItems = []) {
  if (!hasComponents(p)) return null
  return p.components.reduce((sum, c) => {
    const si = stockItems.find(s => s.id === c.stockItemId)
    const w = parseFloat(si?.data?.weightKg ?? si?.weightKg) || 0
    return sum + w * (parseInt(c.qty) || 0)
  }, 0)
}

/** Total units inside a listing (2 of A + 1 of B = 3). */
export function componentUnits(p) {
  if (!hasComponents(p)) return parseInt(p.bundleQty) || 1
  return p.components.reduce((s, c) => s + (parseInt(c.qty) || 0), 0)
}

/**
 * Total shipping weight for a product.
 * For bundles, the per-item weight is multiplied by the bundle quantity,
 * unless a total weight has been manually overridden.
 */
export function effectiveWeight(p, stockItems = []) {
  // Linked listings derive weight from their components, unless overridden
  if (hasComponents(p) && !p.weightOverride) {
    return componentWeight(p, stockItems) || 0
  }
  const bundleQty = parseInt(p.bundleQty) || 1
  if (bundleQty > 1 && !p.weightOverride) {
    return (parseFloat(p.weightPerItem) || 0) * bundleQty
  }
  return parseFloat(p.weightKg) || 0
}

/** A listing's total product cost, from components if linked. */
export function effectiveCost(p, stockItems = []) {
  if (hasComponents(p) && !p.costOverride) {
    return componentCost(p, stockItems) || 0
  }
  const bundleQty = parseInt(p.bundleQty) || 1
  return bundleQty > 1
    ? (parseFloat(p.costPerItem) || 0) * bundleQty
    : (parseFloat(p.costPrice) || 0)
}

/**
 * The sell price at which profit is exactly zero. The referral fee depends
 * on the price (and can jump at category thresholds), so this has to be
 * solved rather than read off the current costs.
 */
function solveBreakEven(fixed, vatRate, feeAt, edges) {
  if (!(fixed > 0)) return 0
  const profitAt = (s) => s / (1 + vatRate) - feeAt(s) - fixed
  const bounds = [0.01, ...edges.filter(e => e > 0.01), 100000]
  for (let i = 0; i < bounds.length - 1; i++) {
    let lo = bounds[i] + (i === 0 ? 0 : 0.0001), hi = bounds[i + 1]
    if (profitAt(hi) < 0) continue
    if (profitAt(lo) >= 0) return lo
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2
      if (profitAt(mid) >= 0) hi = mid; else lo = mid
    }
    return hi
  }
  return null   // can't break even at any price
}

export function calcProduct(p, carriers, packaging, stockItems = []) {
  const sellPrice = parseFloat(p.sellPrice) || 0
  const costPrice = effectiveCost(p, stockItems)
  const adCost = parseFloat(p.adCost) || 0
  const vatRate = p.vatZero ? 0 : 0.20
  const refPct = (parseFloat(p.refFee) || 15.3) / 100
  const weightKg = effectiveWeight(p, stockItems)
  const numParcels = p.parcelSplit ? (parseInt(p.numParcels) || 1) : 1

  const vatAmount = sellPrice * (vatRate / (1 + vatRate))
  const exVatRevenue = sellPrice - vatAmount
  // With a fee category, Amazon's schedule decides the fee (tiers, minimum and
  // the 2% digital services fee included). Without one, the entered percentage
  // is used exactly as before, so nothing existing changes silently.
  const feeCat = p.feeCategory ? findFeeCategory(p.feeCategory) : null
  const referralFee = feeCat ? referralFeeFor(feeCat, sellPrice) : sellPrice * refPct

  let shippingCost = 0
  let shippingWarning = ''

  if (p.carrierId && p.carrierCatId && p.serviceLevel) {
    const carrier = carriers[p.carrierId]
    if (carrier) {
      if (weightKg > carrier.maxWeight) {
        shippingWarning = `Weight (${weightKg}kg) exceeds ${carrier.name} max of ${carrier.maxWeight}kg`
      }
      const cat = carrier.categories.find(c => c.id === p.carrierCatId)
      if (cat) {
        const rate = cat.rates[p.serviceLevel] || 0
        if (p.parcelSplit && p.parcelWeightsOverride && p.parcelWeights?.length) {
          shippingCost = p.parcelWeights.reduce((sum, pw) => {
            const w = parseFloat(pw) || 0
            const matchCat = carrier.categories.find(c => w <= c.maxKg) || carrier.categories[carrier.categories.length - 1]
            return sum + (matchCat ? (matchCat.rates[p.serviceLevel] || 0) : rate)
          }, 0)
        } else {
          shippingCost = rate * numParcels
        }
      }
    }
  }

  let packCost = 0
  if (p.packagingId && packaging) {
    const pk = packaging.find(x => x.id === p.packagingId)
    if (pk) packCost = (parseFloat(pk.cost) || 0) * numParcels
  }

  const totalCosts = costPrice + referralFee + shippingCost + packCost + adCost
  const netProfit = exVatRevenue - totalCosts
  const margin = sellPrice > 0 ? (netProfit / sellPrice) * 100 : 0
  const fixedCosts = costPrice + shippingCost + packCost + adCost
  const breakEven = solveBreakEven(
    fixedCosts, vatRate,
    feeCat ? (s) => referralFeeFor(feeCat, s) : (s) => s * refPct,
    feeCat ? thresholdsFor(feeCat) : [],
  )
  const issues = calcIssues(p, carriers, stockItems, packaging)

  return {
    sellPrice, exVatRevenue, vatAmount, referralFee,
    referralRate: sellPrice > 0 ? referralFee / sellPrice * 100 : 0,
    feeBasis: feeCat ? 'category' : 'manual',
    shippingCost, packCost, adCost, costPrice,
    totalCosts, netProfit, margin, breakEven, shippingWarning,
    issues, incomplete: issues.length > 0,
  }
}

export function getSmartCarrier(weightKg, serviceLevel, isLetterbox, carriers, routingRules) {
  const sorted = [...routingRules].sort((a, b) => a.priority - b.priority)
  for (const rule of sorted) {
    if (rule.serviceLevel && rule.serviceLevel !== serviceLevel) continue
    if (rule.letterbox !== undefined && rule.letterbox !== isLetterbox) continue
    if (rule.weightMax && weightKg > rule.weightMax) continue
    const carrier = carriers[rule.carrierId]
    if (!carrier) continue
    if (weightKg > carrier.maxWeight) continue
    if (!carrier.services[serviceLevel]) continue
    return rule.carrierId
  }
  return null
}

/* ── Pricing and shipping analysis ──────────────────────────────────────── */

/**
 * Price needed to hit a target margin, given everything else on the listing.
 * Shipping and packaging don't move with price, but VAT, the referral fee and
 * the margin itself all do, so this solves rather than guesses.
 *
 *   net  = S/(1+v) - S*r - fixed
 *   want net = S * m
 *   =>  S = fixed / (1/(1+v) - r - m)
 */
export function priceForTargetMargin(p, carriers, packaging, stockItems, targetMarginPct) {
  const target = parseFloat(targetMarginPct) || 0
  const cat = p.feeCategory ? findFeeCategory(p.feeCategory) : null

  if (!cat) {
    const base = calcProduct({ ...p, sellPrice: '0' }, carriers, packaging, stockItems)
    const fixed = base.costPrice + base.shippingCost + base.packCost + base.adCost
    const v = p.vatZero ? 0 : 0.20
    const r = (parseFloat(p.refFee) || 15.3) / 100
    const denom = (1 / (1 + v)) - r - target / 100
    if (denom <= 0) return null
    return fixed / denom
  }

  // With tiered categories the fee jumps at each threshold, so margin is only
  // rising *within* a band. Search band by band for the lowest price that works.
  const marginAt = (price) =>
    calcProduct({ ...p, sellPrice: String(price) }, carriers, packaging, stockItems).margin
  const edges = [0.01, ...thresholdsFor(cat), 5000]
  for (let i = 0; i < edges.length - 1; i++) {
    let lo = edges[i] + (i === 0 ? 0 : 0.001)
    let hi = edges[i + 1]
    if (marginAt(hi) < target) continue
    if (marginAt(lo) >= target) return lo
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2
      if (marginAt(mid) >= target) hi = mid; else lo = mid
    }
    return hi
  }
  return null
}

/** Price needed simply to break even. */
export function priceForBreakEven(p, carriers, packaging, stockItems) {
  return priceForTargetMargin(p, carriers, packaging, stockItems, 0)
}

/**
 * Every carrier option that can physically carry this weight, cheapest first.
 * Used to check a listing is on the best rate rather than the one first chosen.
 */
export function carrierOptions(weightKg, serviceLevel, carriers) {
  const out = []
  Object.entries(carriers || {}).forEach(([carrierId, c]) => {
    if (weightKg > (c.maxWeight || Infinity)) return
    const cat = (c.categories || []).find(x => weightKg <= x.maxKg)
    if (!cat) return
    const rate = cat.rates?.[serviceLevel]
    if (rate === undefined || rate === null) return
    if (rate <= 0) return            // unconfigured rates would look free
    out.push({ carrierId, carrierName: c.name, catId: cat.id, catName: cat.name, rate })
  })
  return out.sort((a, b) => a.rate - b.rate)
}

/** What a listing currently pays, and the cheapest it could pay. */
export function shippingSaving(p, carriers, stockItems = []) {
  const weightKg = effectiveWeight(p, stockItems)
  const service = p.serviceLevel || 'standard'
  if (!weightKg) return null

  const options = carrierOptions(weightKg, service, carriers)
  if (!options.length) return null

  const carrier = carriers[p.carrierId]
  const cat = carrier?.categories?.find(c => c.id === p.carrierCatId)
  const currentRate = cat?.rates?.[service]
  const best = options[0]

  // A carrier with no rate entered isn't free — it's unknown. Saying a listing
  // could "save" against £0.00 would be worse than saying nothing.
  if (currentRate === undefined || currentRate === null || currentRate <= 0) {
    return {
      weightKg,
      currentRate: null,
      currentName: carrier ? `${carrier.name} — ${cat?.name || ''}` : 'Not set',
      service,
      rateMissing: true,
      byService: {},
      cheaperService: null,
      best,
      saving: 0,
      isBest: false,
      options,
    }
  }

  // The same parcel on a different service — a separate decision from carrier,
  // since it changes what the customer is promised
  const byService = {}
  ;['standard', 'nextday', 'prime'].forEach(svc => {
    const opts = carrierOptions(weightKg, svc, carriers)
    if (opts.length) byService[svc] = opts[0]
  })
  const cheaperService = Object.entries(byService)
    .filter(([svc, o]) => svc !== service && o.rate < currentRate - 0.001)
    .sort((a, b) => a[1].rate - b[1].rate)[0]

  return {
    weightKg,
    service,
    currentRate,
    currentName: carrier ? `${carrier.name} — ${cat?.name || ''}` : 'Not set',
    rateMissing: false,
    best,
    saving: currentRate - best.rate,
    isBest: best.carrierId === p.carrierId && best.catId === p.carrierCatId,
    options,
    byService,
    cheaperService: cheaperService
      ? { service: cheaperService[0], ...cheaperService[1], saving: currentRate - cheaperService[1].rate }
      : null,
  }
}

/**
 * Models one product sold at different pack sizes.
 * Weight and cost scale with quantity; shipping steps up in bands, which is
 * what makes large packs stop working.
 */
export function modelPackSizes(stockItem, template, carriers, packaging, sizes = [1,2,3,4,6,8,10,12]) {
  const unitCost = parseFloat(stockItem?.data?.costPrice ?? stockItem?.costPrice) || 0
  const unitWeight = parseFloat(stockItem?.data?.weightKg ?? stockItem?.weightKg) || 0
  const service = template.serviceLevel || 'standard'
  const pricePerUnit = parseFloat(template.pricePerUnit) || 0

  return sizes.map(qty => {
    const weight = unitWeight * qty
    const cost = unitCost * qty
    const options = carrierOptions(weight, service, carriers)
    const best = options[0] || null
    const sell = pricePerUnit * qty

    const p = {
      sellPrice: String(sell),
      costPrice: String(cost),
      bundleQty: '1',
      weightKg: String(weight),
      refFee: template.refFee || '15.3',
      feeCategory: template.feeCategory || '',
      vatZero: !!template.vatZero,
      adCost: template.adCost || '',
      serviceLevel: service,
      carrierId: best?.carrierId || '',
      carrierCatId: best?.catId || '',
      packagingId: template.packagingId || '',
    }
    const r = calcProduct(p, carriers, packaging, [])
    return {
      qty, weight, cost, sell,
      carrier: best ? `${best.carrierName} — ${best.catName}` : 'No carrier fits',
      shippingCost: r.shippingCost,
      shippingPerUnit: qty ? r.shippingCost / qty : 0,
      netProfit: r.netProfit,
      profitPerUnit: qty ? r.netProfit / qty : 0,
      margin: r.margin,
      viable: !!best && r.netProfit > 0,
    }
  })
}
