/**
 * Bulk orders (v2.78.0): an Amazon / eBay / TikTok order sent mostly by pallet (Farrall's), with ONE parcel by DHL or
 * Evri so there is a tracking number the marketplace accepts. 20 × 25kg salt = 1 bag by DHL + 19 on a pallet.
 *
 * The parcel label is made in HELM and uploaded to Dispatch like any other. HELM's packing slip still says 20, so
 * without help Dispatch would see "20 units, one label" and hold it. Here the upload is told which orders are bulk
 * orders (public.bulk_upload_check, matched by channel order number) and the slip is read as the parcel's share —
 * so the stamp says 1, one unit comes off stock, and nothing is held. The pallet's labels (made by the portal) carry
 * the other 19, under the same channel order number.
 *
 * Pallet and parcel labels share an order number on purpose, so "already uploaded" must not fire between them:
 * a parcel upload ignores pallet labels when looking for repeats, and a pallet upload only looks at pallet labels.
 */
export const FARRALLS = "Farrall's"
export const PALLET_CARRIERS = [FARRALLS, 'GForce']
export const isPalletCarrier = (c) => PALLET_CARRIERS.includes(c)

/** The orders in an upload that could be bulk orders: a real slip with one product, more than one of it. For bulk_upload_check. */
export function bulkCandidates(orders = []) {
  const out = []
  for (const o of orders) {
    const s = o?.slip
    if (!s || s.manual || s.wholesale || s.bulk) continue
    const items = s.items || []
    if (items.length !== 1 || !s.channelRef) continue
    const qty = parseInt(items[0].qty, 10) || 0
    if (qty < 2 || !items[0].code) continue
    const l = (o.labels || [])[0] || {}
    out.push({ ref: s.channelRef, code: items[0].code, qty, labels: (o.labels || []).length, carrier: l.carrier || null,
      customer: l.customer || s.customer || null, postcode: l.postcode || s.postcode || null })
  }
  return out
}

const key = (r) => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Read each bulk order's slip as the parcel's share. links: what bulk_upload_check returned
 * ([{ ref, id, parcel_units, units, auto }]). Returns new orders (the input is not changed) and how many were bulk.
 * The label's own "20 x CODE" hint is dropped with it — it describes the whole order, not this parcel.
 */
export function applyBulkLinks(orders = [], links = []) {
  const byRef = new Map((links || []).map(l => [key(l.ref), l]))
  let linked = 0
  const out = orders.map(o => {
    const s = o?.slip
    const link = s && !s.manual && !s.wholesale ? byRef.get(key(s.channelRef)) : null
    if (!link) return o
    const items = s.items || []
    const qty = parseInt(items[0]?.qty, 10) || 0
    const share = parseInt(link.parcel_units, 10) || 0
    // Only ever when the slip is exactly the order the bulk order describes: one product, the same total
    if (items.length !== 1 || share < 1 || share >= qty || (link.units != null && Number(link.units) !== qty)) return o
    linked++
    return {
      ...o,
      labels: (o.labels || []).map(l => { const { itemHint, ...rest } = l; return rest }),
      slip: { ...s, items: [{ ...items[0], qty: share }], bulk: { id: link.id, units: qty, parcelUnits: share, auto: !!link.auto } },
    }
  })
  return { orders: out, linked }
}

/** Earlier labels to compare an upload against: pallet labels and parcel labels never count as repeats of each other */
export function existingForUpload(existing = [], { pallet = false } = {}) {
  return (existing || []).filter(e => (pallet ? isPalletCarrier(e.carrier) : !isPalletCarrier(e.carrier)))
}

/** How many pallets a weight needs, by the carrier's sizes (Quarter / Half / Full, then 2, 3…) — for the label count only */
export function palletsFor(kg, sizes = [{ maxKg: 250 }, { maxKg: 500 }, { maxKg: 1250 }]) {
  const full = Number(sizes[sizes.length - 1]?.maxKg) || 1250
  return kg > full ? Math.ceil(kg / full) : 1
}
