import test from 'node:test'
import assert from 'node:assert/strict'
import { channelFeeFor, describeChannelFee, feeName, groupChannelFees, ruleStates, setChannelFees } from '../src/lib/channelFees.js'
import { calcProduct, priceForTargetMargin } from '../src/lib/calc.js'
import { readiness } from '../src/lib/readiness.js'

const RULES = [
  { id: 1, channel: 'eBay', listing_id: null, from_date: '2026-08-01', pct: 12.55, per_order: 0.40, per_order_small: 0.30, small_order_max: 10 },
  { id: 2, channel: 'eBay', listing_id: 'L1', listing_sku: '366601900474', listing_name: 'Pyrex Glass Measuring Jug 500ml', from_date: '2026-08-01', pct: 12.24 },
  { id: 3, channel: 'TikTok', listing_id: null, from_date: '2026-08-01', pct: 9, per_order: 0.5, per_order_small: null, small_order_max: null },
  { id: 4, channel: 'eBay', listing_id: null, from_date: '2027-01-01', pct: 13, per_order: 0.45, per_order_small: 0.35, small_order_max: 10 },
  { id: 5, channel: 'eBay', listing_id: 'L1', listing_sku: '366601900474', listing_name: 'Pyrex Glass Measuring Jug 500ml', from_date: '2026-11-01', pct: 12.9 },
]
const day = '2026-11-18'
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg || `${a} is not ${b}`)

test('the rule in force: a listing’s own percentage, the channel’s fixed amount, the latest date on or before the day', () => {
  const f = channelFeeFor({ channel: 'eBay', listingSku: ' 366601900474 ' }, { rules: RULES, day })
  assert.equal(f.pct, 12.9); assert.equal(f.own, true); assert.equal(f.fromDate, '2026-11-01')
  assert.equal(f.fixed(8), 0.30); assert.equal(f.fixed(10), 0.30); assert.equal(f.fixed(10.01), 0.40)
  // before its second date the first one applies; in 2027 the channel's fixed amounts change but its own % stays
  assert.equal(channelFeeFor({ channel: 'eBay', listingSku: '366601900474' }, { rules: RULES, day: '2026-10-31' }).pct, 12.24)
  const later = channelFeeFor({ channel: 'eBay', listingSku: '366601900474' }, { rules: RULES, day: '2027-02-01' })
  assert.equal(later.pct, 12.9); assert.equal(later.fixed(50), 0.45)
  // a listing with no row of its own uses the channel's
  const g = channelFeeFor({ channel: 'eBay', listingSku: 'SOMETHING-ELSE' }, { rules: RULES, day })
  assert.equal(g.pct, 12.55); assert.equal(g.own, false)
  // before any rule is dated, there is none
  assert.equal(channelFeeFor({ channel: 'eBay' }, { rules: RULES, day: '2026-07-31' }), null)
})

test('Amazon and channels with no rule have none; the fee is % of the price plus the fixed amount', () => {
  assert.equal(channelFeeFor({ listingSku: 'X' }, { rules: RULES, day }), null)
  assert.equal(channelFeeFor({ channel: 'Amazon' }, { rules: RULES, day }), null)
  assert.equal(channelFeeFor({ channel: 'WooCommerce' }, { rules: RULES, day }), null)
  const t = channelFeeFor({ channel: 'TikTok' }, { rules: RULES, day })
  close(t.feeAt(8.44), 8.44 * 0.09 + 0.5)   // the £5.45 + £2.99 order in TikTok's report: £1.26
  assert.equal(+t.feeAt(8.44).toFixed(2), 1.26)
  assert.equal(t.feeAt(0), 0)
  assert.deepEqual(t.edges, [])
  assert.deepEqual(channelFeeFor({ channel: 'eBay' }, { rules: RULES, day }).edges, [10])
})

test('how a fee is written, and what it is called', () => {
  assert.equal(describeChannelFee(channelFeeFor({ channel: 'eBay' }, { rules: RULES, day })), '12.55% + 40p an order (30p on orders up to £10)')
  assert.equal(describeChannelFee(channelFeeFor({ channel: 'TikTok' }, { rules: RULES, day })), '9% + 50p an order')
  assert.equal(describeChannelFee(channelFeeFor({ channel: 'X' }, { rules: [{ id: 9, channel: 'X', listing_id: null, from_date: '2026-01-01', pct: 2.9, per_order: 1.2 }], day })), '2.9% + £1.20 an order')
  assert.equal(describeChannelFee(null), '')
  assert.equal(feeName({ channel: 'eBay' }), 'eBay fee'); assert.equal(feeName({}), 'Amazon fee')
  assert.equal(feeName({ channel: 'WooCommerce' }), 'Salt 4 U fee'); assert.equal(feeName({ channel: 'Shopify' }), 'Plenty&More fee')
})

test('the settings page: channels, then listings by name, newest date first; which row is current', () => {
  const g = groupChannelFees(RULES)
  assert.deepEqual(g.map(x => x.channel), ['eBay', 'TikTok'])
  assert.deepEqual(g[0].base.map(r => r.id), [4, 1])
  assert.deepEqual(g[0].listings[0].rows.map(r => r.id), [5, 2])
  const st = ruleStates(g[0].base, day)
  assert.equal(st.get(4), 'to come'); assert.equal(st.get(1), 'current')
  const sl = ruleStates(g[0].listings[0].rows, day)
  assert.equal(sl.get(5), 'current'); assert.equal(sl.get(2), 'earlier')
})

test('the Calculator uses the channel’s fee for eBay and TikTok, and Amazon is exactly as it was', () => {
  const carriers = { evri: { name: 'Evri', maxWeight: 15, categories: [{ id: 'c1', maxKg: 2, rates: { standard: 1.97, nextday: 2.07 } }] } }
  const packaging = [{ id: 'pk', name: 'Mailer', cost: 0.12 }]
  const base = { sellPrice: '11.45', costPrice: '3.36', weightKg: '0.52', carrierId: 'evri', carrierCatId: 'c1', serviceLevel: 'standard', packagingId: 'pk', returnsPct: '0' }
  const amazonBefore = calcProduct({ ...base, refFee: '15.3' }, carriers, packaging)
  setChannelFees(RULES.filter(r => r.from_date <= day))
  try {
    const amazon = calcProduct({ ...base, refFee: '15.3' }, carriers, packaging)
    assert.deepEqual({ ...amazon, channelFee: null }, { ...amazonBefore, channelFee: null })
    assert.equal(amazon.feeBasis, 'manual'); close(amazon.referralFee, 11.45 * 0.153)

    const ebay = calcProduct({ ...base, channel: 'eBay', listingSku: '366601900474', refFee: '' }, carriers, packaging)
    assert.equal(ebay.feeBasis, 'channel')
    close(ebay.referralFee, 11.45 * 0.129 + 0.40)
    // profit = price ex VAT − cost − fee − postage − packaging
    close(ebay.netProfit, 11.45 / 1.2 - 3.36 - (11.45 * 0.129 + 0.40) - 1.97 - 0.12)
    // a price of £10 or less takes the small-order amount
    const small = calcProduct({ ...base, channel: 'eBay', listingSku: 'OTHER', sellPrice: '8.00' }, carriers, packaging)
    close(small.referralFee, 8 * 0.1255 + 0.30)
    // break-even: the price at which profit is nil, with the fixed amount in it
    const be = calcProduct({ ...base, channel: 'TikTok', listingSku: 'T' }, carriers, packaging).breakEven
    const at = calcProduct({ ...base, channel: 'TikTok', listingSku: 'T', sellPrice: String(be) }, carriers, packaging)
    assert.ok(Math.abs(at.netProfit) < 0.01, `profit at break-even £${be} is ${at.netProfit}`)
    // the price for a 20% margin really gives 20%
    const p20 = priceForTargetMargin({ ...base, channel: 'eBay', listingSku: '366601900474' }, carriers, packaging, [], 20)
    const m = calcProduct({ ...base, channel: 'eBay', listingSku: '366601900474', sellPrice: String(p20) }, carriers, packaging).margin
    assert.ok(Math.abs(m - 20) < 0.05, `margin at £${p20} is ${m}`)

    // the steps a listing goes through name its own channel
    const steps = readiness({ channel: 'eBay', listingSku: 'X' }, ebay).steps
    assert.equal(steps.find(s => s.key === 'fee').label, 'eBay fee set'); assert.equal(steps.find(s => s.key === 'fee').done, true)
    assert.match(steps.find(s => s.key === 'live').hint, /listed on eBay/)
    const az = readiness({ feeVerified: false }, amazon).steps
    assert.equal(az.find(s => s.key === 'fee').label, 'Amazon fee verified'); assert.match(az.find(s => s.key === 'live').hint, /listed on Amazon/)
  } finally { setChannelFees([]) }
  // with no rules loaded an eBay listing falls back to the entered percentage, never to a crash
  const none = calcProduct({ ...base, channel: 'eBay', refFee: '' }, carriers, packaging)
  assert.equal(none.feeBasis, 'manual')
})

test('delivery the customer pays: revenue, VAT and the channel fee are on price + delivery; nothing changes without it', async () => {
  const { calcProduct, priceForTargetMargin } = await import('../src/lib/calc.js')
  const { setChannelFees } = await import('../src/lib/channelFees.js')
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`)
  setChannelFees([{ id: 1, channel: 'eBay', listing_id: null, from_date: '2026-08-01', pct: 12.55, per_order: 0.40, per_order_small: 0.30, small_order_max: 10 }])
  const base = { channel: 'eBay', listingSku: 'X-1', sellPrice: '12.00', costPrice: '4.00' }
  const a = calcProduct(base, {}, [])
  const same = calcProduct({ ...base, deliveryCharged: '' }, {}, [])
  assert.deepEqual({ ...same, channelFee: null, issues: null }, { ...a, channelFee: null, issues: null })
  assert.equal(a.deliveryCharged, 0); close(a.customerPays, 12)
  // £12.00 + £2.99 delivery: the customer pays £14.99; VAT is a sixth of it; eBay's 12.55% + 40p is on £14.99
  const d = calcProduct({ ...base, deliveryCharged: '2.99' }, {}, [])
  close(d.customerPays, 14.99); close(d.vatAmount, 14.99 / 6); close(d.exVatRevenue, 14.99 - 14.99 / 6)
  close(d.referralFee, 14.99 * 0.1255 + 0.40)
  close(d.netProfit, 14.99 - 14.99 / 6 - (14.99 * 0.1255 + 0.40) - 4)
  close(d.margin, d.netProfit / 14.99 * 100)
  // the small-order step is on what the customer pays in all: £8 + £2.99 is over £10, so 40p not 30p
  close(calcProduct({ ...base, sellPrice: '8.00', deliveryCharged: '2.99' }, {}, []).referralFee, 10.99 * 0.1255 + 0.40)
  close(calcProduct({ ...base, sellPrice: '8.00' }, {}, []).referralFee, 8 * 0.1255 + 0.30)
  // break-even price is lower by the delivery charged, and at that price the profit is nil
  close(d.breakEven, a.breakEven - 2.99)
  close(calcProduct({ ...base, sellPrice: String(d.breakEven), deliveryCharged: '2.99' }, {}, []).netProfit, 0)
  // the price for a 20% margin really gives 20%
  const want = priceForTargetMargin({ ...base, deliveryCharged: '2.99' }, {}, [], [], 20)
  assert.ok(Math.abs(calcProduct({ ...base, sellPrice: String(want), deliveryCharged: '2.99' }, {}, []).margin - 20) < 0.01)
  // an Amazon listing never has it, whatever the field holds
  const am = calcProduct({ sellPrice: '12.00', costPrice: '4.00', deliveryCharged: '2.99' }, {}, [])
  assert.equal(am.deliveryCharged, 0); close(am.vatAmount, 2)
  setChannelFees([])
})
