/**
 * Workflow for hunts: where each listing stands, and whether the data behind
 * a decision is still fresh enough to trust.
 */

export const SKIP_REASONS = [
  'Margin too low',
  'Amazon sells it',
  'Too many sellers',
  "Can't sell this brand",
  'Not our kind of product',
  'Other',
]

export const DISPOSITIONS = {
  pending: { label: 'To decide', tone: 'quiet' },
  sent:    { label: 'Sent to review', tone: 'brand' },
  later:   { label: 'Saved for later', tone: 'paused' },
  skipped: { label: 'Skipped', tone: 'quiet' },
}

/** Days after which data is worth flagging as stale. */
export const STALE_HELIUM_DAYS = 14
export const STALE_PRICELIST_DAYS = 30

export const daysSince = (date) => date ? Math.floor((Date.now() - new Date(date).getTime()) / 86400000) : null

/** "GB_AMAZON_blackBoxProducts_1_2026-09-21.csv" -> "2026-09-21" */
export function heliumDateFromFile(name) {
  const m = String(name || '').match(/(20\d{2})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10)
}

export function defaultHuntName(listings, fileName) {
  const counts = {}
  listings.forEach(l => { if (l.brand) counts[l.brand] = (counts[l.brand] || 0) + 1 })
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const brand = top.length === 0 ? 'Helium import' : top.length > 1 && top[1][1] > top[0][1] * 0.3 ? `${top[0][0]} and others` : top[0][0]
  const d = new Date(heliumDateFromFile(fileName))
  return `${brand} — ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

/**
 * Where a sent listing has got to since it left the hunter. Read live from
 * the listing itself, so the hunter always shows the current state.
 */
export function sentStatus(item, savedProducts, liveProducts) {
  if (!item?.saved_product_id) return null
  const row = savedProducts.find(r => r.id === item.saved_product_id)
  if (!row) return { label: 'Listing removed', tone: 'quiet' }
  const live = liveProducts.find(lp => lp.saved_product_id === row.id)
  if (live) return { label: live.status === 'live' ? 'Live' : 'Paused', tone: live.status === 'live' ? 'live' : 'paused' }
  if (row.data?.archived) return { label: 'Archived', tone: 'quiet' }
  const rs = row.data?.reviewStatus || 'none'
  if (rs === 'review') return { label: 'In review', tone: 'brand' }
  if (rs === 'approved') return { label: 'Approved — ready to order', tone: 'live' }
  if (row.data?.reviewNote) return { label: 'Sent back', tone: 'alert', note: row.data.reviewNote }
  return { label: 'Draft', tone: 'quiet' }
}

/** The same ASIN skipped in other hunts, most recent first. */
export function previousSkips(asin, huntId, huntItems, hunts) {
  return huntItems
    .filter(i => i.asin === asin && i.hunt_id !== huntId && i.disposition === 'skipped')
    .sort((a, b) => new Date(b.decided_at || 0) - new Date(a.decided_at || 0))
    .map(i => ({ ...i, huntName: hunts.find(h => h.id === i.hunt_id)?.name || 'another hunt' }))
}

export function huntProgress(huntId, huntItems) {
  const items = huntItems.filter(i => i.hunt_id === huntId)
  const c = { total: items.length, pending: 0, sent: 0, later: 0, skipped: 0 }
  items.forEach(i => { c[i.disposition] = (c[i.disposition] || 0) + 1 })
  c.decided = c.total - c.pending - c.later
  return c
}

/**
 * Checks that should make you pause before sending: stale data, weights
 * that disagree, a listing that already exists.
 */
export function validityChecks({ listing, match, ev, hunt, savedProducts, stockItems }) {
  const out = []
  const age = daysSince(hunt?.data?.heliumDate || hunt?.created_at)
  if (age !== null && age > STALE_HELIUM_DAYS) {
    out.push({ tone: 'paused', text: `Helium data is ${age} days old — price and sales may have moved` })
  }
  const sp = match?.components?.[0]?.sp
  const listAge = daysSince(sp?.list_date)
  if (listAge !== null && listAge > STALE_PRICELIST_DAYS) {
    out.push({ tone: 'paused', text: `Supplier price list is ${listAge} days old — cost may have changed` })
  }
  const si = sp?.barcode && stockItems.find(s => s.data?.barcode === sp.barcode)
  const unitW = parseFloat(si?.data?.weightKg)
  const qty = match?.components?.[0]?.qty || 1
  if (unitW > 0 && listing?.data?.weightKg > 0) {
    const expected = unitW * qty
    const diff = Math.abs(expected - listing.data.weightKg) / expected
    if (diff > 0.25) out.push({ tone: 'alert', text: `Helium says ${listing.data.weightKg}kg, your product suggests ${expected.toFixed(2)}kg — check the weight` })
  }
  const existing = savedProducts.find(r => (r.data?.asin || '').toUpperCase() === listing.asin)
  if (existing) out.push({ tone: 'brand', text: `Already in your listings as "${existing.name.slice(0, 50)}"`, existingId: existing.id })
  return out
}
