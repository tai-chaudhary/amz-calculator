import test from 'node:test'
import assert from 'node:assert/strict'
import { surchargeOn, surchargeApplies, surchargeState, surchargeProblem, surchargeChanges } from '../src/lib/surcharges.js'
import { buildPnl } from '../src/lib/pnl.js'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`)
const PEAK = { id: 's1', carrierId: 'evri', name: 'Peak surcharge', amount: 0.15, from: '2026-11-15', to: '2026-12-31' }

test('a surcharge is charged from its start date to its end date, both included', () => {
  assert.equal(surchargeApplies(PEAK, '2026-11-14'), false)
  assert.equal(surchargeApplies(PEAK, '2026-11-15'), true)
  assert.equal(surchargeApplies(PEAK, '2026-12-31'), true)
  assert.equal(surchargeApplies(PEAK, '2027-01-01'), false)
  assert.equal(surchargeApplies({ ...PEAK, to: '' }, '2027-06-01'), true)          // no end date yet
  assert.equal(surchargeOn([PEAK], 'evri', '2026-11-20'), 0.15)
  assert.equal(surchargeOn([PEAK], 'dhl', '2026-11-20'), 0)
  near(surchargeOn([PEAK, { ...PEAK, id: 's2', name: 'Fuel', amount: '0.05', from: '2026-11-01', to: null }], 'evri', '2026-11-20'), 0.20)
  assert.equal(surchargeOn([], 'evri', '2026-11-20'), 0); assert.equal(surchargeOn(null, 'evri', '2026-11-20'), 0)
  assert.equal(surchargeState(PEAK, '2026-11-01'), 'to come'); assert.equal(surchargeState(PEAK, '2026-11-19'), 'current'); assert.equal(surchargeState(PEAK, '2027-01-02'), 'ended')
})

test('entering a surcharge: name, amount, start; the end may be left open but not before the start', () => {
  assert.equal(surchargeProblem(PEAK), null)
  assert.equal(surchargeProblem({ ...PEAK, to: '' }), null)
  assert.equal(surchargeProblem({ ...PEAK, name: ' ' }), 'Give it a name')
  assert.equal(surchargeProblem({ ...PEAK, amount: 0 }), 'Give the amount a parcel')
  assert.equal(surchargeProblem({ ...PEAK, from: '' }), 'Give the start date')
  assert.equal(surchargeProblem({ ...PEAK, to: '2026-11-01' }), 'The end date is before the start date')
})

test('what changed, in words, for the activity log', () => {
  const carriers = { evri: { name: 'Evri' } }
  assert.deepEqual(surchargeChanges([], [PEAK], carriers), [{ id: 's1', action: 'Surcharge added', detail: 'Evri: Peak surcharge £0.15 a parcel, 2026-11-15 to 2026-12-31' }])
  assert.deepEqual(surchargeChanges([PEAK], [{ ...PEAK, amount: 0.2, to: '' }], carriers), [{ id: 's1', action: 'Surcharge changed', detail: 'Evri: Peak surcharge £0.20 a parcel, 2026-11-15, no end date (was £0.15, 2026-11-15 to 2026-12-31)' }])
  assert.deepEqual(surchargeChanges([PEAK], [], carriers), [{ id: 's1', action: 'Surcharge removed', detail: 'Evri: Peak surcharge £0.15 a parcel, 2026-11-15 to 2026-12-31' }])
  assert.deepEqual(surchargeChanges([PEAK], [PEAK], carriers), [])
})

test('the P&L adds the surcharge to every parcel the carrier carried in the dates, and to nothing else', () => {
  const base = {
    carriers: {
      evri: { name: 'Evri', maxWeight: 15, services: { nextday: true }, multi: { rule: 'same' }, helmServices: [{ name: 'Evri Next Day Contract Rate', service: 'nextday' }],
        categories: [{ id: 'a', name: 'Under 2KG', maxKg: 2, rates: { nextday: 2.07 } }, { id: 'b', name: '2-15KG', maxKg: 15, rates: { nextday: 2.70 } }] },
      dhl: { name: 'DHL', maxWeight: 30, services: { nextday: true }, multi: { rule: 'subsequent', rate: 3 }, helmServices: [{ name: 'DHL Parcel UK Parcel', service: 'nextday' }],
        categories: [{ id: 'n', name: 'Next Day', maxKg: 30, rates: { nextday: 4.59 } }] },
    },
    packaging: [],
  }
  const withPeak = { ...base, carrierSurcharges: [PEAK] }
  const stockItems = [{ id: 'jug', name: 'Jug', data: { costPrice: '4.51', weightKg: '0.8' } }, { id: 'salt', name: 'Salt', data: { costPrice: '3.17', weightKg: '25' } }]
  const savedById = new Map([
    ['L1', { id: 'L1', name: 'Jug', data: { components: [{ stockItemId: 'jug', qty: 1 }], useComponents: true, sellPrice: '12.95', carrierId: 'evri', carrierCatId: 'a', serviceLevel: 'nextday' } }],
    ['L2', { id: 'L2', name: 'Salt', data: { components: [{ stockItemId: 'salt', qty: 1 }], useComponents: true, sellPrice: '16.90', carrierId: 'dhl', carrierCatId: 'n', serviceLevel: 'nextday' } }],
  ])
  const line = (ref, id, day, qty = 1) => ({ kind: 'sale', sale_date: day, channel: 'Amazon', order_ref: ref, listing_id: id, qty, gross: 12.95 * qty, vat: 2.16 * qty, fees: -1.98 })
  const lines = [line('A', 'L1', '2026-11-14'), line('B', 'L1', '2026-11-15'), line('C', 'L1', '2026-11-20', 2), line('D', 'L2', '2026-11-20'), line('E', 'L1', '2026-11-21', 3), line('F', 'L1', '2027-01-01')]
  const parcels = { A: ['Evri Next Day Contract Rate'], B: ['Evri Next Day Contract Rate'], C: ['Evri Next Day Contract Rate', 'Evri Next Day Contract Rate'], D: ['DHL Parcel UK Parcel'], F: ['Evri Next Day Contract Rate'] }
  const args = { lines, parcels, savedById, stockItems }
  const plain = buildPnl({ ...args, settings: base }), peak = buildPnl({ ...args, settings: withPeak })
  const diff = peak.map((l, i) => l.shipping - plain[i].shipping)
  near(diff[0], 0)            // 14 Nov: the day before it starts
  near(diff[1], 0.15)         // 15 Nov: one Evri parcel
  near(diff[2], 0.30)         // two Evri parcels
  near(diff[3], 0)            // DHL has no surcharge
  near(diff[4], 0.45)         // no label yet: estimated from the listing, three parcels
  near(diff[5], 0)            // after it ends
  near(peak[1].surcharge, 0.15); near(peak[2].surcharge, 0.30); near(peak[4].surcharge, 0.45); assert.equal(peak[3].surcharge || 0, 0)
  near(peak[1].shipping, 2.22)
  // a label the portal holds that HELM does not (Amazon Buy Shipping = our Evri account) carries it too
  const extra = buildPnl({ ...args, lines: [line('G', 'L1', '2026-11-20')], parcels: {}, ship: { extra_labels: { G: [{ carrier: 'Evri', service: 'Next Day' }] } }, settings: withPeak })
  near(extra[0].shipping, 2.22)
  // nothing but shipping moves
  peak.forEach((l, i) => { near(l.packaging, plain[i].packaging); near(l.cogs, plain[i].cogs); near(l.parcels, plain[i].parcels) })
})

test('the P&L screen shows surcharges as their own line under Shipping, inside the same total', async () => {
  const { summarise: sum, extrasByDay } = await import('../src/lib/pnlScreen.js')
  const summarise = (lines) => sum({ lines, ohOn: false, extras: extrasByDay({ days: null, ohByDay: null, ohOn: false }) }, '2026-11-20', '2026-11-20')
  const mk = (o) => ({ kind: 'sale', sale_date: '2026-11-20', channel: 'Amazon', order_ref: o.ref, qty: 1, gross: 12, vat: 2, fees: -1.5, cogs: 4, packaging: 0.1, ...o })
  const lines = [mk({ ref: 'A', shipping: 2.22, surcharge: 0.15, shipCarrier: 'Evri' }), mk({ ref: 'B', shipping: 4.59, shipCarrier: 'DHL' })]
  const t = summarise(lines)
  const total = Object.values(t.shipBy).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(total - t.shipping) < 1e-9); assert.ok(Math.abs(t.shipping - 6.81) < 1e-9)
  assert.ok(Math.abs(t.shipBy.Evri - 2.07) < 1e-9); assert.ok(Math.abs(t.shipBy['Carrier surcharges'] - 0.15) < 1e-9); assert.ok(Math.abs(t.surcharges - 0.15) < 1e-9)
})

test('the Calculator includes a surcharge charged today, a parcel; the P&L still goes by the order’s day and never counts it twice', async () => {
  const { calcProduct } = await import('../src/lib/calc.js')
  const { setCarrierSurcharges, setSurchargeDay } = await import('../src/lib/surcharges.js')
  const carriers = {
    evri: { name: 'Evri', maxWeight: 15, services: { nextday: true }, multi: { rule: 'same' }, helmServices: [{ name: 'Evri Next Day Contract Rate', service: 'nextday' }],
      categories: [{ id: 'a', name: 'Under 2KG', maxKg: 2, rates: { nextday: 2.07 } }] },
    dhl: { name: 'DHL', maxWeight: 30, services: { nextday: true }, multi: { rule: 'subsequent', rate: 3 }, categories: [{ id: 'n', name: 'Next Day', maxKg: 30, rates: { nextday: 4.59 } }] },
  }
  const jug = { sellPrice: '12.95', costPrice: '4.51', weightKg: '0.8', carrierId: 'evri', carrierCatId: 'a', serviceLevel: 'nextday' }
  const before = calcProduct(jug, carriers, [])
  assert.equal(before.shippingSurcharge, 0); near(before.shippingCost, 2.07)
  try {
    setCarrierSurcharges([PEAK]); setSurchargeDay('2026-11-19')
    const now = calcProduct(jug, carriers, [])
    near(now.shippingSurcharge, 0.15); near(now.shippingCost, 2.22); near(now.netProfit, before.netProfit - 0.15)
    // two parcels: twice
    near(calcProduct({ ...jug, parcelSplit: true, numParcels: '2' }, carriers, []).shippingSurcharge, 0.30)
    // another carrier, and a listing with no carrier chosen: nothing
    assert.equal(calcProduct({ ...jug, carrierId: 'dhl', carrierCatId: 'n' }, carriers, []).shippingSurcharge, 0)
    assert.equal(calcProduct({ sellPrice: '12.95', costPrice: '4.51' }, carriers, []).shippingSurcharge, 0)
    // the day after it ends, the Calculator is back to the rate
    setSurchargeDay('2027-01-01'); near(calcProduct(jug, carriers, []).shippingCost, 2.07)

    // the P&L, with today inside the dates: an order with no label yet is estimated at the rate + the surcharge of ITS day
    setSurchargeDay('2026-11-19')
    const settings = { carriers, packaging: [], carrierSurcharges: [PEAK] }
    const stockItems = [{ id: 'jug', name: 'Jug', data: { costPrice: '4.51', weightKg: '0.8' } }]
    const savedById = new Map([['L1', { id: 'L1', name: 'Jug', data: { ...jug, components: [{ stockItemId: 'jug', qty: 1 }], useComponents: true } }]])
    const line = (ref, day, qty = 1) => ({ kind: 'sale', sale_date: day, channel: 'Amazon', order_ref: ref, listing_id: 'L1', qty, gross: 12.95 * qty, vat: 2.16 * qty, fees: -1.98 })
    const out = buildPnl({ lines: [line('OLD', '2026-11-10'), line('NOW', '2026-11-18', 2)], parcels: {}, savedById, stockItems, settings })
    near(out[0].shipping, 2.07)                 // before the surcharge began: the plain rate, though the Calculator shows 2.22 today
    near(out[1].shipping, 2 * 2.22)             // two parcels on 18 Nov: 15p each, once
    near(out[1].surcharge, 0.30)
  } finally { setCarrierSurcharges([]); setSurchargeDay(null) }
})
