/**
 * A listing's identity on its sales channel.
 *
 * Listing SKU = the channel's own SKU for the listing ("Pyrex Jug 500ml-2 Days").
 * Product SKU = our internal SKU for the product (PYREX-JUG-GLASS-500ML). Never the same thing.
 *
 * One portal listing per Listing SKU: the same ASIN can be sold under several Listing SKUs
 * (2-Days, Next Day) at different prices, and each is its own listing, all linked to the ASIN.
 * Orders find their listing by channel + Listing SKU (HELM sends it on every Amazon / TikTok line).
 * Older listings saved before v2.71.0 have no channel: they're Amazon.
 */
import { SALES_CHANNELS } from './channels.js'
export const CHANNELS = SALES_CHANNELS.filter(c => c.listings).map(c => ({ id: c.id, label: c.label, ...c.item }))
export const FULFILMENT = [
  { id: 'FBM', label: 'We send it (FBM)' },
  { id: 'FBA', label: 'Amazon sends it (FBA)' },
]

export const channelOf = (d) => (d && d.channel) || 'Amazon'
export const channelInfo = (id) => CHANNELS.find(c => c.id === id) || CHANNELS[0]
export const channelLabel = (id) => channelInfo(id).label
export const listingSkuOf = (d) => String((d && d.listingSku) || '').trim()
const key = (s) => String(s || '').trim().toUpperCase()
/** The listing's identity key: channel + Listing SKU (empty when it has no Listing SKU yet) */
export const listingKey = (d) => (listingSkuOf(d) ? `${channelOf(d)}|${key(listingSkuOf(d))}` : '')

/**
 * The other codes a listing is sold under. eBay and TikTok send the same listing under several codes (the item
 * number or product ID, the SKU on the listing, HELM's own code), so one listing holds them all: the Listing SKU
 * is the main one and these are the rest. The database keeps them in step (migration 131, listing_codes).
 */
export const otherCodesOf = (d) => [...new Set((Array.isArray(d?.otherCodes) ? d.otherCodes : []).map(c => String(c || '').trim()).filter(Boolean))]
/** Codes typed in a box, separated by commas or new lines → a clean list with no repeats */
export function parseCodes(text) {
  const seen = new Set(); const out = []
  for (const part of String(text || '').split(/[\n,]+/)) {
    const c = part.trim()
    if (c && !seen.has(key(c))) { seen.add(key(c)); out.push(c) }
  }
  return out
}
/** Every code of a listing, the Listing SKU first, upper-cased for matching */
export const listingCodeKeys = (d) => [...new Set([listingSkuOf(d), ...otherCodesOf(d)].filter(Boolean).map(key))]

/** Other saved listings on the same channel that use any of this listing's codes (must be none) */
export function sameListingSku(savedProducts, d, selfId = null) {
  const mine = new Set(listingCodeKeys(d))
  if (!mine.size) return []
  const ch = channelOf(d)
  return (savedProducts || []).filter(row => row.id !== selfId && !row.data?.archived && channelOf(row.data) === ch
    && listingCodeKeys(row.data).some(k => mine.has(k)))
}
