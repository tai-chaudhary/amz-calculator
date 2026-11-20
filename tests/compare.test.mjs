import test from 'node:test'
import assert from 'node:assert/strict'
import { compareChannels, productsKey } from '../src/lib/compare.js'
import { setChannelFees } from '../src/lib/channelFees.js'
import { calcProduct } from '../src/lib/calc.js'

const stockItems = [{ id: 'jug', name: 'Jug', data: { costPrice: '4.00', weightKg: '0.8' } }]
const parts = { useComponents: true, components: [{ stockItemId: 'jug', qty: 1 }] }

test('one product across channels: a saved listing with the same products, else the same price with that channel’s fee', () => {
  setChannelFees([
    { id: 1, channel: 'eBay', listing_id: null, from_date: '2026-08-01', pct: 12.55, per_order: 0.40, per_order_small: 0.30, small_order_max: 10 },
    { id: 2, channel: 'TikTok', listing_id: null, from_date: '2026-08-01', pct: 9, per_order: 0.50 },
  ])
  assert.equal(productsKey({ ...parts, components: [{ stockItemId: 'b', qty: 2 }, { stockItemId: 'a', qty: 1 }] }), 'a×1|b×2')
  assert.equal(productsKey({ components: [{ stockItemId: 'a', qty: 1 }] }), '')
  const calc = { ...parts, channel: 'Amazon', listingSku: 'JUG-2DAYS', sellPrice: '12.95', refFee: '15.3' }
  const saved = [
    { id: 'e1', name: 'Jug on eBay', data: { ...parts, channel: 'eBay', listingSku: 'PYREX-JUG-GLASS-1L', sellPrice: '13.49' } },
    { id: 'e2', name: 'Jug on eBay, dearer', data: { ...parts, channel: 'eBay', listingSku: 'PYREX-JUG-GLASS-1L-X002', sellPrice: '11.00' } },
    { id: 'e3', name: 'Two jugs on eBay', data: { useComponents: true, components: [{ stockItemId: 'jug', qty: 2 }], channel: 'eBay', listingSku: 'JUG-X2', sellPrice: '30' } },
    { id: 'a1', name: 'This one', data: calc },
  ]
  const rows = compareChannels(calc, { savedProducts: saved, carriers: {}, packaging: [], stockItems, excludeId: 'a1' })
  assert.deepEqual(rows.map(x => [x.channel, x.kind]), [['eBay', 'listing'], ['TikTok', 'what-if'], ['Shopify', 'what-if'], ['WooCommerce', 'what-if']])
  // eBay: the better of the two listings that send one jug (not the two-jug listing), with one more noted
  assert.equal(rows[0].listing.id, 'e1'); assert.equal(rows[0].others, 1)
  assert.equal(rows[0].r.netProfit, calcProduct(saved[0].data, {}, [], stockItems).netProfit)
  // TikTok: £12.95 with 9% + 50p
  assert.ok(Math.abs(rows[1].r.referralFee - (12.95 * 0.09 + 0.5)) < 1e-9); assert.equal(rows[1].r.sellPrice, 12.95)
  // the websites have no fee set here: said so, not worked out
  assert.equal(rows[2].noFee, true); assert.equal(rows[2].r, null)
  // from an eBay listing, Amazon is a what-if at 15.3% and never carries the delivery charged
  const back = compareChannels({ ...parts, channel: 'eBay', listingSku: 'Z', sellPrice: '10', deliveryCharged: '2.99' }, { savedProducts: [], carriers: {}, packaging: [], stockItems })
  assert.equal(back[0].channel, 'Amazon'); assert.equal(back[0].r.deliveryCharged, 0); assert.ok(Math.abs(back[0].r.referralFee - 1.53) < 1e-9)
  assert.ok(Math.abs(back[1].r.customerPays - 12.99) < 1e-9)
  setChannelFees([])
})
