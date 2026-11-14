/**
 * The P&L, worked out line by line (v2.76.0) with the same rules as the Calculator, so a corrected cost (a product,
 * a carrier rate, a packaging item) shows straight away everywhere.
 *
 * For every sale / refund line from the sales ledger:
 *   Product cost  units sold × the unit cost IN FORCE ON THE SALE DATE: the price paid on the latest purchase order
 *                 placed on or before that day (case price ÷ units in the case); the product's current cost when it
 *                 has no PO that early ("current cost"). FIFO by delivery comes when Goods In history is long enough.
 *   Shipping      per order, from the parcels HELM actually booked (one per label): each parcel's service → carrier
 *                 (Cost Settings → HELM services), that carrier's rates on the sale date (dated versions), its
 *                 multi-parcel rule (DHL first + subsequent, DPD single or multi), Evri by the order's total weight.
 *                 Orders with no parcels in HELM (before 13 Oct, or labelled elsewhere) use the listing's own
 *                 shipping ("estimated"). An order's shipping is shared across its lines by weight.
 *                 A bulk order (Dispatch → Wholesale) uses its own delivery cost instead: Farrall's pallet for the
 *                 postcode and weight + fuel surcharge + the one tracked parcel and its box.
 *   Wholesale     Stone & Surfaces orders are lines of the "Wholesale" channel: their price-list price as the sale,
 *                 the product cost with it, no delivery (they collect), on the day the pallet was collected.
 *   Packaging     the listing's packaging per parcel, at today's packaging costs (under review).
 * Refunds take back the money; the product cost of the sale stays (most refunded stock isn't resold).
 */
import { calcProduct, parcelsCost } from './calc.js'
import { versionOn } from './costVersions.js'

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }
const r2 = (v) => Math.round(v * 100) / 100

/**
 * stockItemId → [{ date, unit }] newest first, from purchase orders that were placed (not drafts / cancelled).
 * A PO line's price is per pack when the line says how many are in a pack; otherwise it's per unit — unless it only
 * makes sense as a case (older POs priced the case without saying so): then the product's pack size is used when
 * that lands near today's unit cost, and a price that fits neither is not trusted (today's cost is used instead).
 */
export function poCostIndex(purchaseOrders = [], stockItems = []) {
  const siById = new Map(stockItems.map(s => [s.id, s]))
  const near = (x) => x >= 0.5 && x <= 2
  const m = new Map()
  for (const po of purchaseOrders) {
    if (!po || ['draft', 'cancelled'].includes(po.status) || po.kind === 'credit_note') continue
    const date = String(po.sent_at || po.created_at || '').slice(0, 10)
    if (!date) continue
    for (const i of po.items || []) {
      if (!i.stock_item_id || i.line_status === 'cancelled') continue
      const price = num(i.unit_cost)
      if (!(price > 0)) continue
      const si = siById.get(i.stock_item_id)
      const now = num(si?.data?.costPrice)
      const linePack = num(i.data?.packUnits)
      const prodPack = num(si?.data?.packUnits)
      let unit = null
      if (linePack > 1) unit = price / linePack
      else if (linePack === 1 || !(now > 0) || near(price / now)) unit = price
      else if (prodPack > 1 && near(price / prodPack / now)) unit = price / prodPack
      if (unit == null) continue
      const arr = m.get(i.stock_item_id) || []
      arr.push({ date, unit, po: po.po_number })
      m.set(i.stock_item_id, arr)
    }
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.date < b.date ? 1 : -1))
  return m
}

/** The unit cost of a product on a day: the latest PO on or before it, else today's cost */
export function unitCostOn(poIndex, si, date) {
  const hit = (poIndex.get(si?.id) || []).find(x => x.date <= date)
  if (hit) return { unit: hit.unit, from: 'po', po: hit.po }
  return { unit: num(si?.data?.costPrice), from: 'current' }
}

/** HELM service name → { carrierId, serviceLevel } from Cost Settings → Carriers → HELM services */
export function helmServiceMap(carriers = {}) {
  const m = new Map()
  for (const [id, c] of Object.entries(carriers || {})) {
    for (const h of c.helmServices || []) m.set(String(h.name || '').trim().toLowerCase(), { carrierId: id, serviceLevel: h.service || 'nextday' })
  }
  return m
}

/** One parcel's single rate on a carrier: the weight band its weight falls in */
function bandRate(carrier, serviceLevel, kg) {
  const cats = [...(carrier?.categories || [])].sort((a, b) => num(a.maxKg) - num(b.maxKg))
  const cat = cats.find(c => kg <= num(c.maxKg)) || cats[cats.length - 1]
  return num(cat?.rates?.[serviceLevel] ?? cat?.rates?.nextday)
}

/**
 * Work out every line. Returns { lines, totals, notes } — each line with cogs, shipping, packaging and how each was
 * found (cogsFrom: po | current | mixed | none; shipFrom: labels | estimated; packFrom: listing | none).
 */
export function buildPnl({ lines = [], parcels = {}, bulk = {}, savedById, stockItems = [], settings, carrierVersions = [], purchaseOrders = [] }) {
  const carriersNow = settings?.carriers || {}
  const packaging = settings?.packaging || []
  const siById = new Map(stockItems.map(s => [s.id, s]))
  const poIndex = poCostIndex(purchaseOrders, stockItems)
  const svc = helmServiceMap(carriersNow)
  const calcCache = new Map()
  const calcOf = (listing) => {
    if (!listing) return null
    if (!calcCache.has(listing.id)) calcCache.set(listing.id, calcProduct(listing.data || {}, carriersNow, packaging, stockItems))
    return calcCache.get(listing.id)
  }
  const carrierOn = (id, date) => versionOn(carrierVersions, id, date)?.value || carriersNow[id]

  // 1. Each line's product cost and weight
  const out = lines.map(l => {
    const listing = l.listing_id ? savedById.get(l.listing_id) : null
    const p = listing?.data || {}
    const r = calcOf(listing)
    const qty = Math.abs(num(l.qty))
    let cogs = 0, from = new Set()
    if (l.kind === 'sale' && listing) {
      const comps = Array.isArray(p.components) && p.components.length ? p.components : null
      if (comps) {
        for (const c of comps) {
          const si = siById.get(c.stockItemId)
          if (!si) { from.add('none'); continue }
          const u = unitCostOn(poIndex, si, l.sale_date)
          cogs += u.unit * num(c.qty || 1) * qty
          from.add(u.from)
        }
      } else if (r) { cogs = num(r.costPrice) * qty; from.add('current') }
    }
    const kg = r ? num(r.weightPerUnit) * num(r.units || 1) * qty : 0
    // A Stone & Surfaces (wholesale) order: no listing — its product cost comes with it, and they collect it themselves
    if (l.source === 'wholesale') {
      return { ...l, listing: null, qty, kg: 0, cogs: num(l.cogs_fixed), listing_sku: l.listing_sku || l.code || null,
        cogsFrom: l.cogs_fixed == null ? 'none' : 'current', shipping: 0, packaging: 0, shipFrom: 'collected', packFrom: 'none', wholesale: true }
    }
    return {
      ...l, listing, qty, kg, cogs,
      cogsFrom: l.kind !== 'sale' ? 'n/a' : !listing ? 'none' : from.size === 1 ? [...from][0] : from.size ? 'mixed' : 'none',
      shipping: 0, packaging: 0, shipFrom: null, packFrom: null,
    }
  })

  // 2. Shipping and packaging per order, shared across its sale lines by weight
  const orders = new Map()
  out.forEach((l, i) => { if (l.kind === 'sale') { const k = `${l.channel}|${l.order_ref || `line-${i}`}`; (orders.get(k) || orders.set(k, []).get(k)).push(l) } })
  for (const [, ls] of orders) {
    if (ls[0].wholesale) continue
    // A bulk order (sent by pallet, with one parcel for the tracking number): its real delivery cost, worked out when it
    // was arranged — the pallet, the fuel surcharge, the one parcel and that parcel's box. HELM's parcels are not costed again
    const b = bulk[ls[0].order_ref]
    if (b && b.known) {
      const kgAll = ls.reduce((a, l) => a + l.kg, 0)
      ls.forEach(l => { const w = kgAll > 0 ? l.kg / kgAll : 1 / ls.length; l.shipping = num(b.shipping) * w; l.packaging = num(b.packaging) * w; l.shipFrom = 'pallet'; l.packFrom = 'pallet' })
      continue
    }
    const services = parcels[ls[0].order_ref] || null
    const totalKg = ls.reduce((a, l) => a + l.kg, 0)
    let ship = null, n = 1
    if (services && services.length) {
      n = services.length
      const byCarrier = new Map()
      for (const s of services) {
        const hit = svc.get(String(s || '').trim().toLowerCase())
        if (!hit) { ship = null; byCarrier.clear(); break }
        const key = `${hit.carrierId}|${hit.serviceLevel}`
        byCarrier.set(key, (byCarrier.get(key) || 0) + 1)
      }
      if (byCarrier.size) {
        ship = 0
        for (const [key, count] of byCarrier) {
          const [cid, sl] = key.split('|')
          const c = carrierOn(cid, ls[0].sale_date)
          const per = totalKg / n
          ship += parcelsCost(c, Array.from({ length: count }, () => bandRate(c, sl, per)))
        }
      }
    }
    // Packaging: the listing's packaging per parcel (each parcel's own when the listing sets it)
    const packPerParcel = (l) => {
      const r = calcOf(l.listing)
      if (!r) return 0
      const parcelsOnListing = l.listing?.data?.parcelSplit ? Math.max(1, parseInt(l.listing.data.numParcels) || 1) : 1
      return num(r.packCost) / parcelsOnListing
    }
    const weights = ls.map(l => (totalKg > 0 ? l.kg / totalKg : 1 / ls.length))
    if (ship != null) {
      ls.forEach((l, i) => { l.shipping = ship * weights[i]; l.shipFrom = 'labels' })
    } else {
      ls.forEach(l => { const r = calcOf(l.listing); l.shipping = r ? num(r.shippingCost) * l.qty : 0; l.shipFrom = r ? 'estimated' : 'none' })
    }
    if (services && services.length) {
      const heaviest = ls.reduce((a, b) => (b.kg > a.kg ? b : a), ls[0])
      const pack = packPerParcel(heaviest) * n
      ls.forEach((l, i) => { l.packaging = pack * weights[i]; l.packFrom = heaviest.listing ? 'listing' : 'none' })
    } else {
      ls.forEach(l => { const r = calcOf(l.listing); l.packaging = r ? num(r.packCost) * l.qty : 0; l.packFrom = r ? 'listing' : 'none' })
    }
  }
  return out
}

/** Add up worked-out lines by a key: month, day, channel, asin, listing */
export function groupPnl(lines, by = 'month') {
  const keyOf = (l) => by === 'day' ? l.sale_date : by === 'month' ? l.sale_date.slice(0, 7) : by === 'channel' ? l.channel
    : by === 'asin' ? (l.asin || '(no ASIN)') : (l.listing_sku || '(no Listing SKU)')
  const m = new Map()
  for (const l of lines) {
    const k = keyOf(l)
    const g = m.get(k) || { key: k, name: null, listing_id: null, asin: null, channel: new Set(), orders: new Set(), units: 0, sales: 0, refunds: 0, fees: 0, cogs: 0, shipping: 0, packaging: 0,
      cogsCurrent: 0, shipEstimated: 0, shipPallet: 0, unlinked: 0, lines: 0 }
    g.lines++; g.channel.add(l.channel)
    if (by === 'listing' || by === 'asin') { g.name = g.name || l.listing?.name || (l.wholesale ? l.name : null) || null; g.listing_id = g.listing_id || l.listing_id; g.asin = g.asin || l.asin }
    const net = num(l.gross) - num(l.vat)
    if (l.kind === 'sale') {
      g.sales += net; g.units += l.qty; if (l.order_ref) g.orders.add(l.order_ref)
      g.cogs += l.cogs; g.shipping += l.shipping; g.packaging += l.packaging
      if (l.cogsFrom === 'current' || l.cogsFrom === 'mixed') g.cogsCurrent++
      if (l.shipFrom === 'estimated') g.shipEstimated++
      if (!l.listing && !l.wholesale) g.unlinked++
      if (l.shipFrom === 'pallet') g.shipPallet++
    } else g.refunds += net
    g.fees += num(l.fees)
    m.set(k, g)
  }
  return [...m.values()].map(g => {
    const profit = g.sales + g.refunds + g.fees - g.cogs - g.shipping - g.packaging
    return { ...g, channel: [...g.channel].join(', '), orders: g.orders.size, profit: r2(profit), margin: g.sales ? (profit / g.sales) * 100 : null,
      sales: r2(g.sales), refunds: r2(g.refunds), fees: r2(g.fees), cogs: r2(g.cogs), shipping: r2(g.shipping), packaging: r2(g.packaging) }
  })
}
