/**
 * What each sales channel charges (migrations 133–134, table channel_fees).
 *
 * Amazon's fee lives on the listing (a fee category or a percentage) and is untouched by this file. Every other
 * channel has dated rules: one for the channel (its percentage, and a fixed amount an order) and, where a listing's
 * percentage differs (eBay charges by category), one for that listing. A rule applies from its date; the rule in
 * force on a day is the latest one dated on or before it.
 *
 *   percentage   of what the customer paid (the price, delivery included where they pay it), fee before VAT
 *   an order     a fixed amount per order: eBay 40p (30p on orders up to £10), TikTok 50p
 *
 * The app loads the rules once (people who see costs) and keeps them here, so the Calculator and every list that
 * works out a listing's profit use the same fee without each screen passing it around.
 */
import { channelDisplayName } from './channels.js'
let RULES = []
export function setChannelFees(rules) { RULES = Array.isArray(rules) ? rules : [] }
export function getChannelFees() { return RULES }

const key = (s) => String(s || '').trim().toUpperCase()
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const channelOf = (p) => (p && p.channel) || 'Amazon'

/** The latest rule dated on or before the day (ties: the one entered last) */
function inForce(rows, day) {
  return rows.filter(r => String(r.from_date) <= day)
    .sort((a, b) => String(b.from_date).localeCompare(String(a.from_date)) || (b.id || 0) - (a.id || 0))[0] || null
}

/**
 * The fee rule for a listing on a day, or null when its channel has none (Amazon, or a channel not set up yet).
 * Returns { channel, pct, own, perOrder, perOrderSmall, smallMax, fromDate, fixed(orderTotal), feeAt(price), edges }.
 * `own` is true when the percentage is the listing's own rather than the channel's.
 */
export function channelFeeFor(p, { rules = RULES, day = todayIso() } = {}) {
  const channel = channelOf(p)
  if (channel === 'Amazon') return null
  const mine = (rules || []).filter(r => r.channel === channel)
  if (!mine.length) return null
  const base = inForce(mine.filter(r => !r.listing_id), day)
  const sku = key(p && p.listingSku)
  const own = sku ? inForce(mine.filter(r => r.listing_id && key(r.listing_sku) === sku), day) : null
  const pctRow = own || base
  if (!pctRow) return null
  const pct = num(pctRow.pct) ?? 0
  const perOrder = base ? (num(base.per_order) ?? 0) : 0
  const perOrderSmall = base ? num(base.per_order_small) : null
  const smallMax = base ? num(base.small_order_max) : null
  const stepped = perOrderSmall !== null && smallMax !== null
  const fixed = (orderTotal) => (stepped && (parseFloat(orderTotal) || 0) <= smallMax ? perOrderSmall : perOrder)
  return {
    channel, pct, own: !!own, perOrder, perOrderSmall: stepped ? perOrderSmall : null, smallMax: stepped ? smallMax : null,
    fromDate: pctRow.from_date, fixed,
    feeAt: (price) => (price > 0 ? price * pct / 100 + fixed(price) : 0),
    edges: stepped ? [smallMax] : [],
  }
}

const money = (n) => (n < 1 ? `${Math.round(n * 100)}p` : `£${n.toFixed(2)}`)
/** "12.24% + 40p an order (30p on orders up to £10)" */
export function describeChannelFee(f) {
  if (!f) return ''
  const parts = [`${Number(f.pct.toFixed(2))}%`]
  if (f.perOrder > 0 || f.perOrderSmall !== null) {
    parts.push(`${money(f.perOrder)} an order${f.perOrderSmall !== null ? ` (${money(f.perOrderSmall)} on orders up to £${Number(f.smallMax.toFixed(2))})` : ''}`)
  }
  return parts.join(' + ')
}

/** "eBay fee", "TikTok fee", "Salt 4 U fee", "Amazon fee": what to call the channel's charge on a screen */
export function feeName(p) {
  const c = channelOf(p)
  return `${channelDisplayName(c)} fee`
}

/** The rules of the page, grouped: [{ channel, base: [rows, newest first], listings: [{ listing_id, name, sku, rows }] }] */
export function groupChannelFees(rules) {
  const out = new Map()
  for (const r of rules || []) {
    if (!out.has(r.channel)) out.set(r.channel, { channel: r.channel, base: [], listings: new Map() })
    const g = out.get(r.channel)
    if (!r.listing_id) g.base.push(r)
    else {
      if (!g.listings.has(r.listing_id)) g.listings.set(r.listing_id, { listing_id: r.listing_id, name: r.listing_name || '', sku: r.listing_sku || '', rows: [] })
      g.listings.get(r.listing_id).rows.push(r)
    }
  }
  const newest = (a, b) => String(b.from_date).localeCompare(String(a.from_date)) || (b.id || 0) - (a.id || 0)
  return [...out.values()].map(g => ({
    channel: g.channel, base: g.base.sort(newest),
    listings: [...g.listings.values()].map(l => ({ ...l, rows: l.rows.sort(newest) })).sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => a.channel.localeCompare(b.channel))
}

/** Which of a list of dated rows is in force today, and which are still to come: Map(id → 'current' | 'to come' | 'earlier') */
export function ruleStates(rows, day = todayIso()) {
  const cur = inForce(rows || [], day)
  return new Map((rows || []).map(r => [r.id, String(r.from_date) > day ? 'to come' : cur && r.id === cur.id ? 'current' : 'earlier']))
}
