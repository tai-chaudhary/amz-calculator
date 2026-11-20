/**
 * Carrier surcharges (v2.106.0) — e.g. Evri's peak surcharge, 15p a parcel from 15 Nov 2026.
 *
 * Kept in Cost Settings as `carrierSurcharges`: [{ id, carrierId, name, amount, from, to }] — £ a parcel ex VAT, from a
 * date to a date (both days included; no end date = until one is given). They sit BESIDE the carrier's rates, not
 * inside them: a rate change is a dated version of the whole rate card, a surcharge carries its own dates and any of
 * its three figures can be corrected later. The P&L adds the surcharges in force on the order's day to every parcel
 * that carrier carried — real labels and estimates alike. Amazon Buy Shipping labels are our Evri account, so Evri's
 * surcharge is on them too.
 */
import { londonToday } from './dates.js'

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }

// The saved surcharges, for the Calculator and every listing figure (v2.107.0 — the owner: "Yes", they should include a
// surcharge while it runs). App sets this from Cost Settings; calcProduct reads it. Tests can fix the day.
let current = [], fixedDay = null
export const setCarrierSurcharges = (list) => { current = Array.isArray(list) ? list : [] }
export const setSurchargeDay = (day) => { fixedDay = day || null }
/** £ a parcel on top of this carrier's rate TODAY */
export const surchargeToday = (carrierId) => (current.length ? surchargeOn(current, carrierId, fixedDay || londonToday()) : 0)
/** The surcharges of this carrier charged today, for showing which they are */
export const surchargesToday = (carrierId) => current.filter(s => s.carrierId === carrierId && surchargeApplies(s, fixedDay || londonToday()))

export const surchargesOf = (settings) => (Array.isArray(settings?.carrierSurcharges) ? settings.carrierSurcharges : [])

/** Is this surcharge charged on `day` (YYYY-MM-DD)? */
export const surchargeApplies = (s, day) => !!s && !!s.from && String(s.from) <= String(day) && (!s.to || String(day) <= String(s.to))

/** £ a parcel to add for this carrier on this day: every surcharge of the carrier in force that day */
export function surchargeOn(list, carrierId, day) {
  if (!carrierId || !day) return 0
  let t = 0
  for (const s of list || []) if (s.carrierId === carrierId && surchargeApplies(s, day)) t += num(s.amount)
  return t
}

/** 'to come' | 'current' | 'ended', against today */
export function surchargeState(s, today) {
  if (!s?.from || String(s.from) > String(today)) return 'to come'
  return s.to && String(s.to) < String(today) ? 'ended' : 'current'
}

/** What is wrong with a surcharge being entered, or null */
export function surchargeProblem(s) {
  if (!String(s?.name || '').trim()) return 'Give it a name'
  if (!(num(s?.amount) > 0)) return 'Give the amount a parcel'
  if (!s?.from) return 'Give the start date'
  if (s.to && String(s.to) < String(s.from)) return 'The end date is before the start date'
  return null
}

const gbp = (n) => `£${num(n).toFixed(2)}`
const span = (s) => `${s.from}${s.to ? ` to ${s.to}` : ', no end date'}`
const say = (s, name) => `${name}: ${s.name} ${gbp(s.amount)} a parcel, ${span(s)}`

/** What changed between two saved lists, in words — for the activity log */
export function surchargeChanges(before = [], after = [], carriers = {}) {
  const out = []
  const nameOf = (id) => carriers?.[id]?.name || 'Carrier'
  const was = new Map((before || []).map(s => [s.id, s]))
  for (const s of after || []) {
    const b = was.get(s.id)
    if (!b) out.push({ id: s.id, action: 'Surcharge added', detail: say(s, nameOf(s.carrierId)) })
    else if (JSON.stringify(b) !== JSON.stringify(s)) out.push({ id: s.id, action: 'Surcharge changed', detail: `${say(s, nameOf(s.carrierId))} (was ${gbp(b.amount)}, ${span(b)})` })
    was.delete(s.id)
  }
  for (const b of was.values()) out.push({ id: b.id, action: 'Surcharge removed', detail: say(b, nameOf(b.carrierId)) })
  return out
}
