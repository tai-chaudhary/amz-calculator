/**
 * The sales channels — ONE list (v2.105.0). Listing choices, the P&L tabs, the channel mark, the fee names and the
 * CSV import all read it, so a new channel is added here and nowhere else in the app.
 *
 *   id        what the database holds on listings and sale lines (never change one: history is keyed on it)
 *   name      what people call it — "Plenty&More", not "Shopify"
 *   label     the longer name in the Calculator's channel choice
 *   listings  it has listings (Wholesale does not: its prices come from the client's price list)
 *   website   our own shop: orders are baskets with no listing (see productPackaging.js)
 *   item      the channel's own id for a listing: its name, the listing field that holds it, and placeholders
 *   chip      the colours of the channel mark
 *   charges   what the channel bills outside any one order, for the P&L's "other charges" row
 *
 * The database has its own mapping from HELM's shop names to these ids (sales_refresh_helm); that one is not read
 * from here.
 */
const PID = { itemLabel: 'Product ID', itemField: 'itemId' }
export const SALES_CHANNELS = [
  { id: 'Amazon', name: 'Amazon', label: 'Amazon', listings: true, website: false,
    item: { itemLabel: 'ASIN', itemField: 'asin', itemPlaceholder: 'e.g. B08XYZ1234', urlPlaceholder: 'https://www.amazon.co.uk/dp/...' },
    chip: 'bg-[#FFF1D6] text-[#7A4A00] border-[#F1D9A6]', charges: 'subscription, incentives, claims' },
  { id: 'eBay', name: 'eBay', label: 'eBay', listings: true, website: false,
    item: { itemLabel: 'Item number', itemField: 'itemId', itemPlaceholder: 'e.g. 285123456789', urlPlaceholder: 'https://www.ebay.co.uk/itm/...' },
    chip: 'bg-[#E3EEFF] text-[#0B4AA8] border-[#BCD3FA]', charges: 'Promoted Listings, shop and insertion fees' },
  { id: 'TikTok', name: 'TikTok', label: 'TikTok Shop', listings: true, website: false,
    item: { ...PID, itemPlaceholder: 'e.g. 1729384756', urlPlaceholder: 'https://www.tiktok.com/...' },
    chip: 'bg-[#16181D] text-white border-[#16181D]', charges: 'adjustments' },
  { id: 'Shopify', name: 'Plenty&More', label: 'Plenty&More (website)', listings: true, website: true,
    item: { ...PID, itemPlaceholder: 'e.g. 1234', urlPlaceholder: 'https://...' },
    chip: 'bg-[#E2F4E8] text-[#14632E] border-[#B9E0C5]', charges: 'shop subscription, apps' },
  { id: 'WooCommerce', name: 'Salt 4 U', label: 'Salt 4 U (website)', listings: true, website: true,
    item: { ...PID, itemPlaceholder: 'e.g. 1234', urlPlaceholder: 'https://...' },
    chip: 'bg-[#EEE8FB] text-[#4B2A99] border-[#D5C7F3]', charges: 'payment charges' },
  { id: 'Wholesale', name: 'Wholesale', label: 'Wholesale', listings: false, website: false, item: null, chip: null, charges: null },
]

const BY_ID = new Map(SALES_CHANNELS.map(c => [c.id, c]))
export const salesChannel = (id) => BY_ID.get(id) || null
/** Every channel id, in the order the screens show them */
export const CHANNEL_IDS = SALES_CHANNELS.map(c => c.id)
/** The channels that have listings, in order */
export const LISTING_CHANNEL_IDS = SALES_CHANNELS.filter(c => c.listings).map(c => c.id)
/** What people call a channel; an id the list does not know is shown as it is */
export const channelDisplayName = (id) => BY_ID.get(id)?.name || id
/** Our own shops: their orders are baskets */
export const isWebsite = (id) => !!BY_ID.get(id)?.website
/** The id for a typed channel name ("ebay", "Plenty&More", "shopify"), or null */
export function channelIdFrom(text) {
  const t = String(text || '').trim().toLowerCase()
  if (!t) return null
  const hit = SALES_CHANNELS.find(c => c.id.toLowerCase() === t || c.name.toLowerCase() === t || c.label.toLowerCase() === t)
  return hit ? hit.id : null
}
