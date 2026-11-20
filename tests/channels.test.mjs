import test from 'node:test'
import assert from 'node:assert/strict'
import { SALES_CHANNELS, CHANNEL_IDS, LISTING_CHANNEL_IDS, channelDisplayName, isWebsite, channelIdFrom, salesChannel } from '../src/lib/channels.js'
import { CHANNELS, channelInfo, channelLabel } from '../src/lib/listing.js'
import { feeName } from '../src/lib/channelFees.js'
import { isWebsiteChannel } from '../src/lib/productPackaging.js'

test('one list of sales channels: ids, names and order are what every screen had before', () => {
  assert.deepEqual(CHANNEL_IDS, ['Amazon', 'eBay', 'TikTok', 'Shopify', 'WooCommerce', 'Wholesale'])
  assert.deepEqual(LISTING_CHANNEL_IDS, ['Amazon', 'eBay', 'TikTok', 'Shopify', 'WooCommerce'])
  assert.deepEqual(CHANNEL_IDS.map(channelDisplayName), ['Amazon', 'eBay', 'TikTok', 'Plenty&More', 'Salt 4 U', 'Wholesale'])
  assert.equal(channelDisplayName('Something new'), 'Something new')
  assert.equal(new Set(CHANNEL_IDS).size, SALES_CHANNELS.length)
  assert.equal(salesChannel('Nope'), null)
})

test('the listing choices come from the list, unchanged', () => {
  assert.deepEqual(CHANNELS[0], { id: 'Amazon', label: 'Amazon', itemLabel: 'ASIN', itemField: 'asin', itemPlaceholder: 'e.g. B08XYZ1234', urlPlaceholder: 'https://www.amazon.co.uk/dp/...' })
  assert.deepEqual(CHANNELS.map(c => c.label), ['Amazon', 'eBay', 'TikTok Shop', 'Plenty&More (website)', 'Salt 4 U (website)'])
  assert.deepEqual(CHANNELS.map(c => c.itemLabel), ['ASIN', 'Item number', 'Product ID', 'Product ID', 'Product ID'])
  assert.equal(channelInfo('eBay').itemField, 'itemId'); assert.equal(channelInfo('unknown').id, 'Amazon'); assert.equal(channelLabel('TikTok'), 'TikTok Shop')
})

test('fee names, websites and typed channel names read the same list', () => {
  assert.equal(feeName({ channel: 'WooCommerce' }), 'Salt 4 U fee'); assert.equal(feeName({ channel: 'Shopify' }), 'Plenty&More fee'); assert.equal(feeName({}), 'Amazon fee')
  assert.deepEqual(CHANNEL_IDS.filter(isWebsite), ['Shopify', 'WooCommerce']); assert.equal(isWebsiteChannel('Shopify'), true); assert.equal(isWebsiteChannel('Amazon'), false)
  assert.equal(channelIdFrom(' ebay '), 'eBay'); assert.equal(channelIdFrom('Plenty&More'), 'Shopify'); assert.equal(channelIdFrom('woocommerce'), 'WooCommerce')
  assert.equal(channelIdFrom('salt 4 u'), 'WooCommerce'); assert.equal(channelIdFrom(''), null); assert.equal(channelIdFrom('Etsy'), null)
})

test('price lists: a price for one that is really the price of a case is caught', async () => {
  const { casePriceSuspects } = await import('../src/lib/priceLists.js')
  const rows = [
    { sku: 'A', name: 'Harpic', unitCost: 12.49, data: { caseSize: 12, casePrice: 12.49 } },        // the case price as the price of one
    { sku: 'B', name: 'Fine', unitCost: 1.04, data: { caseSize: 12, casePrice: 12.49 } },
    { sku: 'C', name: 'Single', unitCost: 5, data: { caseSize: 1, casePrice: 5 } },                  // a case of one is not a mistake
    { sku: 'D', name: 'No case details', unitCost: 5, data: {} },
    { sku: 'E', name: 'Dearer than retail', unitCost: 9, data: { rsp: 3.5 } },
    { sku: 'F', name: 'Near the case price', unitCost: 11.5, data: { caseSize: 6, casePrice: 12 } },
    { sku: 'G', name: 'Nothing', unitCost: 0, data: { caseSize: 6, casePrice: 12 } },
  ]
  const hits = casePriceSuspects(rows)
  assert.deepEqual(hits.map(x => x.row.sku), ['A', 'E', 'F'])
  assert.equal(hits[0].why, '£12.49 for one, and £12.49 for a case of 12')
  assert.deepEqual(casePriceSuspects(null), [])
})
