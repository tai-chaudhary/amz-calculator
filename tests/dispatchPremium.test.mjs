// Premium in Dispatch (v2.110.0): Amazon's paid faster delivery on offers that are not Prime, marked exactly like Prime.
// First rule, as for Prime: with nothing Premium, an upload plans, groups and saves EXACTLY as it did before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planUpload, splitPrime, premiumOrdersOfDay, primeOrdersOfDay } from '../src/lib/dispatch.js'

const o = (ref, code, carrier = 'Evri') => ({
  slip: { channelRef: ref, items: [{ code, name: code, qty: 1 }] },
  labels: [{ pageIndex: 0, carrier, service: 'Next Day', refs: [ref], postcode: 'AB1 2CD' }],
})
const maps = ['SALT', 'JUG'].map(c => ({ item_key: `${c}x1`, label_name: c, parcels: 1 }))
const orders = [o('026-1111111-1111111', 'SALT'), o('026-2222222-2222222', 'SALT'), o('026-3333333-3333333', 'JUG'), o('026-4444444-4444444', 'SALT', 'DHL')]
const set = (refs = [], all = false) => ({ refs: new Set(refs), postcodes: new Set(), all, checked: true })

test('with nothing Premium, an upload plans exactly as it did before', () => {
  const before = planUpload(orders, maps)
  for (const p of [null, set(), set(['02699999999999999'])]) {
    const now = planUpload(orders, maps, { premium: p })
    assert.deepEqual(now.batches, before.batches); assert.deepEqual(now.checked, before.checked)
    assert.ok(now.batches.every(b => !('premium' in b))); assert.ok(now.checked.every(x => !('premium' in x)))
  }
  // A Prime-only plan splits as it always did: the Prime part and the rest keep their old shape
  const pr = planUpload(orders, maps, { prime: set(['02611111111111111']), premium: set() })
  assert.deepEqual(splitPrime(pr.batches, pr.heldBack).map(x => Object.keys(x).sort().join()), ['batches,held,prime', 'batches,held,prime'])
})

test('Premium orders get their own group and batch, after Prime and before the rest', () => {
  const plan = planUpload(orders, maps, { prime: set(['02611111111111111']), premium: set(['02622222222222222']) })
  assert.deepEqual(plan.checked.map(x => [!!x.prime, !!x.premium]), [[true, false], [false, true], [false, false], [false, false]])
  assert.equal(plan.checked[1].premiumSource, 'helm')
  const salt = plan.batches.filter(b => b.label_name === 'SALT' && b.carrier === 'Evri')
  assert.equal(salt.length, 2, 'Prime SALT and Premium SALT apart; no plain Evri SALT left')
  const parts = splitPrime(plan.batches, plan.heldBack)
  assert.deepEqual(parts.map(x => (x.prime ? 'prime' : x.premium ? 'premium' : 'rest')), ['prime', 'premium', 'rest'])
  assert.equal(parts.reduce((n, p) => n + p.batches.reduce((m, b) => m + b.labels.length, 0), 0), 4, 'every label in exactly one batch')
})

test('an order is never both: Prime wins, even with both ticks', () => {
  const plan = planUpload(orders, maps, { prime: set([], true), premium: set([], true) })
  assert.ok(plan.checked.every(x => x.prime && !x.premium))
  assert.deepEqual(splitPrime(plan.batches, plan.heldBack).map(x => !!x.prime), [true])
  const tagged = planUpload(orders, maps, { prime: set(['02611111111111111']), premium: set(['02611111111111111']) })
  assert.equal(tagged.checked[0].prime, true); assert.equal(tagged.checked[0].premium, undefined)
})

test('the tick is the backup; a whole file ticked Premium is one Premium batch', () => {
  const plan = planUpload(orders, maps, { premium: set([], true) })
  assert.ok(plan.checked.every(x => x.premium && x.premiumSource === 'upload'))
  assert.deepEqual(splitPrime(plan.batches, plan.heldBack).map(x => !!x.premium), [true])
  const both = planUpload(orders, maps, { premium: set(['02611111111111111'], true) })
  assert.equal(both.checked[0].premiumSource, 'both')
})

test('the Premium tile counts Premium orders only, the Prime tile is unchanged', () => {
  const batches = [{ id: 'p', prime: true }, { id: 'm', premium: true }, { id: 'n' }]
  const L = (batch_id, order_key, status) => ({ id: `${batch_id}${order_key}${status}`, batch_id, upload_id: 'u', order_key, status })
  const labels = [L('p', 'A', 'ready'), L('m', 'B', 'ready'), L('m', 'B', 'dispatched'), L('m', 'C', 'dispatched'), L('n', 'D', 'ready')]
  assert.deepEqual(primeOrdersOfDay(batches, labels), { orders: 1, gone: 0 })
  assert.deepEqual(premiumOrdersOfDay(batches, labels), { orders: 2, gone: 1 })
  assert.deepEqual(premiumOrdersOfDay(), { orders: 0, gone: 0 })
})
