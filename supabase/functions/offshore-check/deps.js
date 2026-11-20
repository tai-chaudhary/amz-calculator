// COPIES of parcelsCost (src/lib/calc.js) and surchargeOn (src/lib/surcharges.js) for the offshore-check job.
const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }

export function parcelsCost(carrier, singleRates = []) {
  const n = singleRates.length
  if (!n) return 0
  const sum = singleRates.reduce((a, r) => a + (Number(r) || 0), 0)
  const m = carrier?.multi
  const mr = Number(m?.rate)
  if (!m || !(mr >= 0) || m.rule === 'same' || m.rule == null || n === 1) return sum
  if (m.rule === 'subsequent') return (Number(singleRates[0]) || 0) + mr * (n - 1)
  if (m.rule === 'all') return mr * n
  return sum
}

export const surchargeApplies = (s, day) => !!s && !!s.from && String(s.from) <= String(day) && (!s.to || String(day) <= String(s.to))

/** £ a parcel to add for this carrier on this day: every surcharge of the carrier in force that day */
export function surchargeOn(list, carrierId, day) {
  if (!carrierId || !day) return 0
  let t = 0
  for (const s of list || []) if (s.carrierId === carrierId && surchargeApplies(s, day)) t += num(s.amount)
  return t
}
