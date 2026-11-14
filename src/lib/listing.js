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
export const CHANNELS = [
  { id: 'Amazon', label: 'Amazon', itemLabel: 'ASIN', itemField: 'asin', itemPlaceholder: 'e.g. B08XYZ1234', urlPlaceholder: 'https://www.amazon.co.uk/dp/...' },
  { id: 'eBay', label: 'eBay', itemLabel: 'Item number', itemField: 'itemId', itemPlaceholder: 'e.g. 285123456789', urlPlaceholder: 'https://www.ebay.co.uk/itm/...' },
  { id: 'TikTok', label: 'TikTok Shop', itemLabel: 'Product ID', itemField: 'itemId', itemPlaceholder: 'e.g. 1729384756', urlPlaceholder: 'https://www.tiktok.com/...' },
  { id: 'WooCommerce', label: 'Salt 4 U (website)', itemLabel: 'Product ID', itemField: 'itemId', itemPlaceholder: 'e.g. 1234', urlPlaceholder: 'https://...' },
]
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

/** Other saved listings using the same channel + Listing SKU (must be none) */
export function sameListingSku(savedProducts, d, selfId = null) {
  const k = listingKey(d)
  if (!k) return []
  return (savedProducts || []).filter(row => row.id !== selfId && !row.data?.archived && listingKey(row.data) === k)
}
