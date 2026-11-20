/**
 * The P&L, worked out line by line (v2.76.0) with the same rules as the Calculator, so a corrected cost (a product,
 * a carrier rate, a packaging item) shows straight away everywhere.
 *
 * For every sale / refund line from the sales ledger:
 *   Cost of goods sold  the real cost of the stock each order used, first in first out — pre-live stock first, then
 *                 deliveries in date order — from the database's costing (cost_rebuild → cost_uses), every channel.
 *                 A sale the costing has not reached yet is estimated: units sold × the price paid on the latest
 *                 purchase order on or before that day, else the product's current cost.
 *   Shipping      per order, from the parcels HELM actually booked (one per label): each parcel's service → carrier
 *                 (Cost Settings → HELM services), that carrier's rates on the sale date (dated versions), its
 *                 multi-parcel rule (DHL first + subsequent, DPD single or multi), Evri by the order's total weight.
 *                 A label Dispatch holds that HELM does not (bought through Amazon Buy Shipping, Veeqo or the
 *                 carrier's site; a second parcel) counts as a parcel too, at our rate for its carrier and service.
 *                 Orders with no label at all use the listing's own shipping ("estimated") — for one line of several
 *                 units, as many parcels as that listing and quantity has really gone in since HELM, where known.
 *                 An order's shipping is shared across its lines by weight.
 *                 A bulk order (Dispatch → Wholesale) uses its own delivery cost instead: Farrall's pallet for the
 *                 postcode and weight + fuel surcharge + the one tracked parcel and its box.
 *   Wholesale     Stone & Surfaces orders are lines of the "Wholesale" channel: their price-list price as the sale,
 *                 the product cost with it, no delivery (they collect), on the day the pallet was collected.
 *   Packaging     the listing's packaging per parcel, at today's packaging costs (under review). A website order with
 *                 no listing is one basket: the dearest of its products' own packaging, once per parcel (v2.105.0).
 * Refunds take back the money; the product cost of the sale stays (most refunded stock isn't resold).
 */
import { calcProduct, parcelsCost } from './calc.js'
import { versionOn } from './costVersions.js'
import { groupProductPackaging, basketPackaging, isWebsiteChannel } from './productPackaging.js'
import { surchargesOf, surchargeOn } from './surcharges.js'
import { zonesOf, zoneFor, zoneCost } from './offshore.js'

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
 * found (cogsFrom: fifo | po | current | mixed | none; shipFrom: labels | estimated; packFrom: listing | none).
 */
export function buildPnl({ lines = [], parcels = {}, bulk = {}, ship = null, savedById, stockItems = [], settings, carrierVersions = [], purchaseOrders = [], productPackaging = [] }) {
  const carriersNow = settings?.carriers || {}
  // v2.91.0 (report_pl_ship): labels the portal holds that HELM does not, weights for orders with no listing, and how
  // each listing and quantity has really shipped. All optional — without them shipping is worked out as before
  const extraLabels = ship?.extra_labels || {}
  const orderKg = ship?.weights || {}
  const patterns = ship?.ship_patterns || {}
  const carrierByName = new Map(Object.entries(carriersNow).map(([id, c]) => [String(c?.name || '').trim().toLowerCase(), id]))
  // A label in Dispatch: its carrier by name, "Standard" (48 hour) or next day. Amazon Buy Shipping labels are our own
  // Evri account, so they cost our Evri rate
  const labelHit = (lb) => {
    const id = carrierByName.get(String(lb?.carrier || '').trim().toLowerCase())
    return id ? { carrierId: id, serviceLevel: /standard|48|2\s*day/i.test(String(lb?.service || '')) ? 'standard' : 'nextday' } : null
  }
  const packaging = settings?.packaging || []
  const siById = new Map(stockItems.map(s => [s.id, s]))
  // v2.105.0 — website orders (Plenty&More, Salt 4 U) have no listing: one basket, "the biggest item decides the box"
  const prodPack = groupProductPackaging(productPackaging)
  const typeCostOf = (id) => { const t = packaging.find(x => x.id === id); return t ? parseFloat(t.cost) || 0 : null }
  const siBySku = new Map(stockItems.filter(x => x?.data?.sku).map(x => [String(x.data.sku).trim().toUpperCase(), x.id]))
  const orderProducts = ship?.order_products || {}
  // the products of an order: the stock that left for it, else its lines' own product codes (a website line carries one)
  const productsOf = (ls, ref) => {
    const left = (orderProducts[ref] || []).map(x => x.id).filter(Boolean)
    if (left.length) return left
    return ls.map(l => siBySku.get(String(l.item_code || l.listing_sku || '').trim().toUpperCase())).filter(Boolean)
  }
  const poIndex = poCostIndex(purchaseOrders, stockItems)
  const svc = helmServiceMap(carriersNow)
  const calcCache = new Map()
  const calcOf = (listing) => {
    if (!listing) return null
    if (!calcCache.has(listing.id)) calcCache.set(listing.id, calcProduct(listing.data || {}, carriersNow, packaging, stockItems))
    return calcCache.get(listing.id)
  }
  const carrierOn = (id, date) => versionOn(carrierVersions, id, date)?.value || carriersNow[id]
  // v2.106.0 — carrier surcharges (Evri's peak surcharge): £ a parcel on the order's day, on top of the rate
  const surList = surchargesOf(settings)
  const sur = (carrierId, date) => (surList.length ? surchargeOn(surList, carrierId, date) : 0)
  // v2.109.0 — remote zones (Highlands & Islands, Northern Ireland, the islands): an order to a district in one of its
  // carrier's zones costs the zone's price instead of the mainland rate. The district (first half of the postcode)
  // comes from the Amazon report, HELM or the label (report_order_districts). Without it the order costs as before.
  const zones = zonesOf(settings)
  const districts = ship?.districts || {}
  // the cost of `count` parcels of `kg` each on a carrier: { cost, extra } — extra is what the zone adds over mainland
  const parcelsOn = (c, cid, sl, count, kg, ref, date) => {
    const mainland = parcelsCost(c, Array.from({ length: count }, () => bandRate(c, sl, kg)))
    const zone = zones.length ? zoneFor(zones, cid, districts[ref], date) : null
    if (!zone) return { cost: mainland, extra: 0 }
    const z = zoneCost(zone, Array.from({ length: count }, () => kg))
    return { cost: z, extra: z - mainland, zone: zone.name }
  }

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
    // v2.83.0: the costing's own figure for this line — what the stock this order used actually cost, first in first
    // out (cost_uses, shared out by report_pl_lines). The PO-price working above is only the stand-in for a sale the
    // costing has not reached yet (the last few days, or a line it could not match to a product).
    const real = l.kind === 'sale' && l.cogs_real != null
    if (real) { cogs = num(l.cogs_real); from = new Set(['fifo']) }
    const kg = r ? num(r.weightPerUnit) * num(r.units || 1) * qty : 0
    // A Stone & Surfaces (wholesale) order: no listing — its product cost comes with it, and they collect it themselves
    if (l.source === 'wholesale') {
      return { ...l, listing: null, qty, kg: 0, cogs: num(l.cogs_fixed), listing_sku: l.listing_sku || l.code || null,
        cogsFrom: l.cogs_fixed == null ? 'none' : 'current', shipping: 0, packaging: 0, shipFrom: 'collected', packFrom: 'none', wholesale: true }
    }
    return {
      ...l, listing, qty, kg, cogs,
      cogsFrom: l.kind !== 'sale' ? 'n/a' : real ? 'fifo' : !listing ? 'none' : from.size === 1 ? [...from][0] : from.size ? 'mixed' : 'none',
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
      ls.forEach(l => { const w = kgAll > 0 ? l.kg / kgAll : 1 / ls.length; l.shipping = num(b.shipping) * w; l.packaging = num(b.packaging) * w; l.shipFrom = 'pallet'; l.packFrom = 'pallet'; l.parcels = w; l.shipCarrier = 'Pallet and parcel (bulk orders)' })
      continue
    }
    const ref = ls[0].order_ref
    const services = parcels[ref] || null
    const lineKg = ls.reduce((a, l) => a + l.kg, 0)
    // An order whose lines have no listing (eBay, TikTok) has no weight of its own: the weight of the stock that went out
    const totalKg = lineKg > 0 ? lineKg : num(orderKg[ref])
    let ship = null, n = 1, via = null, remote = 0, remoteZone = null
    const hits = []
    let known = true
    for (const s of services || []) {
      const hit = svc.get(String(s || '').trim().toLowerCase())
      if (!hit) { known = false; break }
      hits.push(hit)
    }
    const helmN = known ? hits.length : 0
    // Labels the portal holds beyond HELM's: bought through Amazon Buy Shipping, Veeqo or the carrier's own site, or a
    // second parcel sent later. One the Cost Settings have no carrier for is left out, as before
    if (known) for (const lb of extraLabels[ref] || []) { const hit = labelHit(lb); if (hit) hits.push(hit) }
    if (known && hits.length) {
      n = hits.length
      via = helmN === n ? 'helm' : helmN ? 'helm+portal' : 'portal'
      const byCarrier = new Map()
      for (const hit of hits) { const key = `${hit.carrierId}|${hit.serviceLevel}`; byCarrier.set(key, (byCarrier.get(key) || 0) + 1) }
      ship = 0
      for (const [key, count] of byCarrier) {
        const [cid, sl] = key.split('|')
        const c = carrierOn(cid, ls[0].sale_date)
        const per = totalKg / n
        const q = parcelsOn(c, cid, sl, count, per, ref, ls[0].sale_date)
        ship += q.cost; remote += q.extra; if (q.zone) remoteZone = q.zone
      }
    }
    // surcharges in force that day, on every parcel of the carrier that has one
    const surAll = ship != null ? hits.reduce((a, h) => a + sur(h.carrierId, ls[0].sale_date), 0) : 0
    if (surAll) ship += surAll
    // Packaging: the listing's packaging per parcel (each parcel's own when the listing sets it)
    const packPerParcel = (l) => {
      const r = calcOf(l.listing)
      if (!r) return 0
      const parcelsOnListing = l.listing?.data?.parcelSplit ? Math.max(1, parseInt(l.listing.data.numParcels) || 1) : 1
      return num(r.packCost) / parcelsOnListing
    }
    const weights = ls.map(l => (lineKg > 0 ? l.kg / lineKg : 1 / ls.length))
    if (ship != null) {
      // who carried it, for the breakdown under Shipping (v2.93.0)
      const names = [...new Set(hits.map(h => carriersNow[h.carrierId]?.name || 'Carrier'))]
      const who = names.length === 1 ? names[0] : 'More than one carrier'
      ls.forEach((l, i) => { l.shipping = ship * weights[i]; l.shipFrom = 'labels'; l.shipVia = via; l.shipCarrier = who; l.parcels = n * weights[i]; l.surcharge = surAll * weights[i]; l.remote = remote * weights[i]; l.remoteZone = remoteZone })
    } else {
      // No label to go by. One line of several units: how that listing and quantity has really shipped since HELM
      // (parcels and service, seen on at least two orders) — not one parcel for every unit
      const one = ls.length === 1 && ls[0].listing && ls[0].qty > 1 ? ls[0] : null
      const pat = one ? patterns[`${one.listing.id}|${one.qty}`] : null
      const hit = pat && Number(pat.parcels) > 0 ? svc.get(String(pat.service || '').trim().toLowerCase()) : null
      if (hit) {
        const c = carrierOn(hit.carrierId, one.sale_date)
        const count = Number(pat.parcels)
        const q = parcelsOn(c, hit.carrierId, hit.serviceLevel, count, totalKg / count, ref, one.sale_date)
        one.shipping = q.cost; one.remote = q.extra; one.remoteZone = q.zone || null
        one.surcharge = sur(hit.carrierId, one.sale_date) * count; one.shipping += one.surcharge
        one.shipFrom = 'estimated'; one.shipVia = 'pattern'; one.parcels = count; one.shipCarrier = `Estimated, no label yet (${carriersNow[hit.carrierId]?.name || 'carrier'})`
      } else {
        ls.forEach(l => {
          const r = calcOf(l.listing); l.shipping = r ? (num(r.shippingCost) - num(r.shippingSurcharge)) * l.qty : 0; l.shipFrom = r ? 'estimated' : 'none'   // the listing's rate without TODAY's surcharge; the order's day decides below
          // v2.109.0 — to a remote district: the listing's carrier's zone price for its parcels instead of the mainland rate
          const lcid = l.listing?.data?.carrierId
          const zone = r && lcid && zones.length ? zoneFor(zones, lcid, districts[ref], l.sale_date) : null
          if (zone) {
            const per = l.listing?.data?.parcelSplit ? Math.max(1, parseInt(l.listing.data.numParcels) || 1) : 1
            const count = per * l.qty
            const z = zoneCost(zone, Array.from({ length: count }, () => (count ? num(l.kg) / count : 0)))
            l.remote = z - l.shipping; l.remoteZone = zone.name; l.shipping = z
          }
          // parcels, for "fulfilment cost a parcel" (v2.105.0): the listing's parcels for each one sold; none known without a listing
          l.parcels = r ? (l.listing?.data?.parcelSplit ? Math.max(1, parseInt(l.listing.data.numParcels) || 1) : 1) * l.qty : 0
          l.surcharge = r ? sur(l.listing?.data?.carrierId, l.sale_date) * l.parcels : 0; l.shipping += l.surcharge
          const cn = carriersNow[l.listing?.data?.carrierId]?.name
          l.shipCarrier = r ? `Estimated, no label yet${cn ? ` (${cn})` : ''}` : null
        })
      }
    }
    if (isWebsiteChannel(ls[0].channel) && ls.some(l => !l.listing)) {
      // A website basket: the dearest packaging among its products (and any listing on it), once for each real parcel
      const b = basketPackaging({ productIds: productsOf(ls, ref), rows: prodPack, day: ls[0].sale_date, costOf: typeCostOf })
      let dearest = b.known ? b.cost : null
      for (const l of ls) if (l.listing) dearest = Math.max(dearest ?? 0, packPerParcel(l))
      const boxes = ship != null ? n : (services && services.length) || 1
      ls.forEach((l, i) => { l.packaging = dearest == null ? 0 : dearest * boxes * weights[i]; l.packFrom = dearest == null ? 'none' : 'basket' })
    } else if (ship != null || (services && services.length)) {
      const heaviest = ls.reduce((a, b) => (b.kg > a.kg ? b : a), ls[0])
      const pack = packPerParcel(heaviest) * (ship != null ? n : services.length)
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
      if (l.cogsFrom !== 'fifo' && !l.wholesale) g.cogsCurrent++   // not costed by the costing yet: estimated, or none
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
