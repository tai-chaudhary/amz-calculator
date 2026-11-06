/**
 * Dated cost versions (v2.72.0).
 *
 * Every saved change to a cost is kept with the date it applies FROM. The P&L costs each order with the
 * version in force on that order's date, so a new rate never rewrites earlier months. An admin can set
 * the date in the past (a rate that really changed last month and was forgotten); that is logged.
 * The current value still lives where it always did (Cost Settings), so every page reads it as before.
 */
import { SERVICE_LABELS } from './defaults'

export const MULTI_RULES = [
  { id: 'same', label: 'Same rate for every parcel', short: 'Same per parcel' },
  { id: 'subsequent', label: 'First parcel, then a lower rate for each extra parcel', short: 'First + subsequent' },
  { id: 'all', label: 'One rate for a single parcel, another for every parcel when there are 2 or more', short: 'Single or multi' },
]

const money = (n) => `£${(Number(n) || 0).toFixed(2)}`

/** The version of `ref` that applies on `date` (YYYY-MM-DD): the latest one starting on or before it */
export function versionOn(versions, ref, date) {
  return (versions || [])
    .filter(v => v.ref === ref && v.effective_from <= date)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1
      : (a.created_at < b.created_at ? 1 : -1)))[0] || null
}

/** Which carriers changed between two Cost Settings, and what changed in words */
export function carrierChanges(before = {}, after = {}) {
  const out = []
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  for (const id of ids) {
    const a = before?.[id], b = after?.[id]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    if (!b) { out.push({ id, value: { ...a, removed: true }, summary: `${a?.name || 'Carrier'} removed` }); continue }
    if (!a) { out.push({ id, value: b, summary: `${b.name} added` }); continue }
    const bits = []
    if (a.name !== b.name) bits.push(`renamed to ${b.name}`)
    if (a.maxWeight !== b.maxWeight) bits.push(`max weight ${a.maxWeight}kg → ${b.maxWeight}kg`)
    const catsA = new Map((a.categories || []).map(c => [c.id, c]))
    for (const c of b.categories || []) {
      const o = catsA.get(c.id)
      if (!o) { bits.push(`added ${c.name}`); continue }
      for (const [sl, label] of Object.entries(SERVICE_LABELS)) {
        const x = Number(o.rates?.[sl] || 0), y = Number(c.rates?.[sl] || 0)
        if (x !== y) bits.push(`${c.name} ${label} ${money(x)} → ${money(y)}`)
      }
      if (o.maxKg !== c.maxKg) bits.push(`${c.name} up to ${c.maxKg}kg`)
      if (o.name !== c.name) bits.push(`${o.name} renamed ${c.name}`)
    }
    for (const o of a.categories || []) if (!(b.categories || []).some(c => c.id === o.id)) bits.push(`removed ${o.name}`)
    const ma = a.multi || {}, mb = b.multi || {}
    if ((ma.rule || 'same') !== (mb.rule || 'same') || Number(ma.rate || 0) !== Number(mb.rate || 0)) {
      const r = MULTI_RULES.find(x => x.id === (mb.rule || 'same'))
      bits.push(`more than one parcel: ${r?.short || 'Same per parcel'}${mb.rule && mb.rule !== 'same' ? ` at ${money(mb.rate)}` : ''}`)
    }
    if (JSON.stringify(a.helmServices || []) !== JSON.stringify(b.helmServices || [])) bits.push('HELM services changed')
    if (JSON.stringify(a.services) !== JSON.stringify(b.services)) bits.push('services changed')
    out.push({ id, value: b, summary: `${b.name}: ${bits.join(', ') || 'changed'}` })
  }
  return out
}

/** Plain words for a carrier's multi-parcel rule, with a worked example */
export function multiExample(carrier) {
  const m = carrier?.multi || {}
  const first = Number(carrier?.categories?.[0]?.rates?.nextday || carrier?.categories?.[0]?.rates?.standard || 0)
  const r = Number(m.rate || 0)
  if (!m.rule || m.rule === 'same') return first ? `2 parcels = 2 × ${money(first)} = ${money(first * 2)}` : 'Each parcel at its own rate'
  if (m.rule === 'subsequent') return `2 parcels = ${money(first)} + ${money(r)} = ${money(first + r)} · 3 parcels = ${money(first + r * 2)}`
  if (m.rule === 'all') return `1 parcel = ${money(first)} · 2 parcels = 2 × ${money(r)} = ${money(r * 2)}`
  return ''
}
