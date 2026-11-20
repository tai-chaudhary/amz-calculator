/**
 * Off Shore orders (v2.109.0) — the carriers' remote areas, and the cheapest way to send an order there.
 *
 * Carriers charge more for some postcodes: Evri bills the Scottish Highlands & Islands (all of Aberdeen included),
 * Northern Ireland, the Isle of Man and the other islands at £4.00 / £5.00 instead of £1.99 / £2.60; DHL has its
 * Zones C and D; DPD its Highlands & Islands and offshore rates. Each of those is a REMOTE ZONE in Cost Settings:
 *
 *   settings.carrierZones = [{ id, carrierId, name, postcodes: 'AB, IV1-IV63, PA20-PA49', bands: [{ maxKg, rate }],
 *                              next, from, to, note, checked }]
 *
 * kept beside the carriers (like the surcharges), each with its own dates, so the P&L costs every order with the zone
 * in force on its day and a zone added later never rewrites a version of the carrier's rates. `rate` is the whole
 * price of a parcel in that zone, before VAT and including the carrier's fuel and levies (as the carriers' own rates
 * in Cost Settings are). `next` is the price of each further parcel in one order; left empty, every parcel costs `rate`.
 *
 * Only the postcode DISTRICT is used (the first half, e.g. "AB51") — that is all the carriers' lists need.
 *
 * The carriers themselves carry two flags used here: `active` (switched off = never suggested; DPD until its
 * collections start) and `primeOk` (may carry a Prime order — DHL is not accepted on Prime / Ship+).
 */
import { parcelsCost } from './calc.js'
import { surchargeOn } from './surcharges.js'

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }
const r2 = (v) => Math.round(v * 100) / 100

/** No parcel goes out heavier than this, whatever the carrier allows (the owner: "the maximum weight we send per parcel is 25KG") */
export const MAX_PARCEL_KG = 25

/** "AB51 4XY" / "ab514xy" / Amazon's "AB51 4" → "AB51"; null when it can't be a postcode */
export function districtOf(postcode) {
  const s = String(postcode || '').trim().toUpperCase()
  if (!s) return null
  let d
  if (s.includes(' ')) d = s.split(/\s+/)[0]
  else { const t = s.replace(/\s/g, ''); d = t.length >= 5 ? t.slice(0, -3) : t }
  return /^[A-Z]{1,2}[0-9][0-9A-Z]?$/.test(d) ? d : null
}

const splitDistrict = (d) => { const m = String(d || '').match(/^([A-Z]{1,2})([0-9]{1,2})([A-Z]?)$/); return m ? { area: m[1], n: parseInt(m[2], 10), tail: m[3] } : null }

/**
 * A postcode list as typed in Cost Settings → a test for a district. Comma separated; each piece is an area
 * ("BT", "IV"), one district ("PH3", "EC1A") or a range ("AB31-AB38", "AB31-38").
 */
export function parsePostcodes(spec) {
  const parts = String(spec || '').toUpperCase().split(/[,;\n]+/).map(s => s.replace(/\s/g, '')).filter(Boolean)
  const tests = []
  const bad = []
  for (const p of parts) {
    let m
    if ((m = p.match(/^([A-Z]{1,2})$/))) { const a = m[1]; tests.push(d => splitDistrict(d)?.area === a); continue }
    if ((m = p.match(/^([A-Z]{1,2})(\d{1,2})-(?:([A-Z]{1,2}))?(\d{1,2})$/))) {
      const a = m[1], lo = +m[2], hi = +m[4]
      if (m[3] && m[3] !== a) { bad.push(p); continue }
      tests.push(d => { const x = splitDistrict(d); return !!x && x.area === a && x.n >= Math.min(lo, hi) && x.n <= Math.max(lo, hi) })
      continue
    }
    if ((m = p.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)$/))) { const one = m[1]; tests.push(d => d === one); continue }
    bad.push(p)
  }
  return { test: (d) => !!d && tests.some(t => t(d)), bad, count: tests.length }
}

const matchers = new Map()
const matcherOf = (spec) => { if (!matchers.has(spec)) matchers.set(spec, parsePostcodes(spec)); return matchers.get(spec) }

export const zonesOf = (settings) => (Array.isArray(settings?.carrierZones) ? settings.carrierZones : [])
const inForce = (z, day) => !day || ((!z.from || String(z.from) <= String(day)) && (!z.to || String(day) <= String(z.to)))

/** The remote zone of this carrier a district falls in on a day, or null (mainland) */
export function zoneFor(zones, carrierId, district, day) {
  if (!district || !carrierId) return null
  for (const z of zones || []) if (z.carrierId === carrierId && inForce(z, day) && matcherOf(z.postcodes || '').test(district)) return z
  return null
}

/** Every carrier zone a district is in (any carrier, switched on or not) — "is this an off shore postcode at all?" */
export function zonesForDistrict(zones, district, day) {
  return (zones || []).filter(z => inForce(z, day) && matcherOf(z.postcodes || '').test(district))
}

/** A parcel's price in a zone: the band its weight falls in (the heaviest band if over) */
export function zoneRate(zone, kg) {
  const bands = [...(zone?.bands || [])].filter(b => num(b.rate) > 0 || num(b.maxKg) > 0).sort((a, b) => num(a.maxKg) - num(b.maxKg))
  if (!bands.length) return 0
  return num((bands.find(b => kg <= num(b.maxKg) + 1e-9) || bands[bands.length - 1]).rate)
}

/** The parcels of an order in a zone: the first at its band, each further one at `next` (or its own band) */
export function zoneCost(zone, boxesKg = []) {
  if (!boxesKg.length) return 0
  const hasNext = zone?.next !== '' && zone?.next != null && Number.isFinite(parseFloat(zone.next))
  return boxesKg.reduce((t, kg, i) => t + (i > 0 && hasNext ? num(zone.next) : zoneRate(zone, kg)), 0)
}

/** One parcel's mainland rate on a carrier: the weight band its weight falls in */
export function bandRate(carrier, serviceLevel, kg) {
  const cats = [...(carrier?.categories || [])].sort((a, b) => num(a.maxKg) - num(b.maxKg))
  const cat = cats.find(c => kg <= num(c.maxKg) + 1e-9) || cats[cats.length - 1]
  return num(cat?.rates?.[serviceLevel] ?? cat?.rates?.nextday)
}

/** The heaviest a single parcel can be on this carrier: its own limit, never over 25kg. Evri takes under 15kg */
export function parcelCap(carrier) {
  const m = Math.min(num(carrier?.maxWeight) || MAX_PARCEL_KG, MAX_PARCEL_KG)
  // Evri is for UNDER its limit (Dispatch holds a 15kg box on an Evri label)
  return /evri/i.test(String(carrier?.name || '')) ? m - 0.01 : m
}

/**
 * Pack the units of an order into parcels no heavier than `cap` (heaviest first, each into the first parcel it fits).
 * Returns the parcels' weights, or null when one unit alone is heavier than the cap (this carrier can't take it).
 */
export function packParcels(unitsKg = [], cap = MAX_PARCEL_KG) {
  const units = unitsKg.map(num).filter(k => k > 0).sort((a, b) => b - a)
  if (!units.length) return [0]
  const boxes = []
  for (const kg of units) {
    if (kg > cap + 1e-9) return null
    const i = boxes.findIndex(x => x + kg <= cap + 1e-9)
    if (i >= 0) boxes[i] += kg
    else boxes.push(kg)
  }
  return boxes.map(r2)
}

/** Is this carrier switched on (missing = on, as every carrier was before this release) */
export const isActive = (c) => c?.active !== false
/** May this carrier take a Prime order (missing = yes) */
export const takesPrime = (c) => c?.primeOk !== false

/**
 * What one carrier would charge for these units to this district on this day.
 * → { carrierId, name, boxes, cost, mainland, extra, zone, why } or { carrierId, name, why } when it can't take them.
 */
export function quoteCarrier({ carrierId, carrier, unitsKg, district, day, zones = [], surcharges = [], serviceLevel = 'nextday' }) {
  const name = carrier?.name || 'Carrier'
  const boxes = packParcels(unitsKg, parcelCap(carrier))
  if (!boxes) return { carrierId, name, why: `An item is over ${name}'s ${+parcelCap(carrier).toFixed(1)}kg a parcel` }
  const zone = zoneFor(zones, carrierId, district, day)
  if (zone?.notServed) return { carrierId, name, why: `${name} doesn't deliver to ${zone.name}` }
  const mainland = parcelsCost(carrier, boxes.map(kg => bandRate(carrier, serviceLevel, kg)))
  const sur = surchargeOn(surcharges, carrierId, day) * boxes.length
  const base = zone ? zoneCost(zone, boxes) : mainland
  return { carrierId, name, boxes, zone, cost: r2(base + sur), mainland: r2(mainland + sur), extra: r2(base - mainland) }
}

/**
 * The cheapest carrier for an order. carriers: Cost Settings carriers. Only carriers switched on, and for a Prime
 * order only those that take Prime. Ties go to the order's current HELM carrier, then to fewer parcels.
 * → { best, options (cheapest first), refused, offshore (the district is in some carrier's zone), status }
 *   status: 'surcharged' (the cheapest way still costs more than mainland) | 'free' (an off shore postcode that the
 *   cheapest carrier sends at its mainland price) | 'mainland' | 'no-carrier' | 'no-weight'
 */
export function bestCarrier({ carriers = {}, unitsKg = [], district, prime = false, day, zones = [], surcharges = [], currentCarrierName = '' }) {
  const offshore = !!district && zonesForDistrict(zones, district, day).length > 0
  const refused = []
  const options = []
  for (const [carrierId, carrier] of Object.entries(carriers || {})) {
    if (!isActive(carrier)) continue
    if (prime && !takesPrime(carrier)) { refused.push({ carrierId, name: carrier.name, why: `${carrier.name} doesn't take Prime orders` }); continue }
    const q = quoteCarrier({ carrierId, carrier, unitsKg, district, day, zones, surcharges })
    if (q.cost == null) refused.push(q)
    else options.push(q)
  }
  const cur = String(currentCarrierName || '').toLowerCase()
  options.sort((a, b) => a.cost - b.cost || (b.name.toLowerCase() === cur) - (a.name.toLowerCase() === cur) || a.boxes.length - b.boxes.length)
  const best = options[0] || null
  const noWeight = !unitsKg.some(k => num(k) > 0)
  const status = !best ? 'no-carrier' : noWeight ? 'no-weight' : best.extra > 0.004 ? 'surcharged' : offshore ? 'free' : 'mainland'
  return { best, options, refused, offshore, status }
}

/**
 * Every unit's weight in an open order. lines: [{ qty, kg }] from HELM's items with the product's weight; a line with
 * no product weight falls back to its listing's weight a unit. Returns { unitsKg, unknown } (unknown = lines with no weight).
 */
export function unitsOf(order, listingKgBySku = new Map()) {
  const unitsKg = []
  let unknown = 0
  const lines = order?.lines || []
  for (const l of lines) {
    const kg = num(l.kg)
    const q = Math.max(1, Math.round(num(l.qty) || 1))
    if (kg > 0) { for (let i = 0; i < q; i++) unitsKg.push(kg) } else unknown++
  }
  if (unknown && order?.listings?.length) {
    // no product weight for some lines: use the listings' own weight (a listing of 2 × 10kg weighs 20kg)
    let fromListings = []
    let all = true
    for (const ll of order.listings) {
      // a listing's weight: a number, or { kg, units } — a 2 × 10kg bundle is two 10kg units, packable apart
      const v = listingKgBySku.get(String(ll.listing_sku || '').trim().toLowerCase())
      const kg = typeof v === 'object' && v ? num(v.kg) : num(v)
      const units = typeof v === 'object' && v ? Math.max(1, Math.round(num(v.units) || 1)) : 1
      if (!(kg > 0)) { all = false; break }
      for (let i = 0; i < Math.max(1, Math.round(num(ll.qty) || 1)) * units; i++) fromListings.push(kg / units)
    }
    if (all && fromListings.length) return { unitsKg: fromListings, unknown: 0, fromListing: true }
  }
  return { unitsKg, unknown }
}

/** "Isle of Man" when the district is in that zone of any carrier — the area's plain name for the page */
export function areaName(zones, district, day) {
  const z = zonesForDistrict(zones, district, day)
  if (!z.length) return null
  const evri = z.find(x => /evri/i.test(x.carrierId))
  return (evri || z[0]).name.replace(/^Zone [A-D]\s*[–-]\s*/i, '')
}

export const OFFSHORE_ALERT_GBP = 10
