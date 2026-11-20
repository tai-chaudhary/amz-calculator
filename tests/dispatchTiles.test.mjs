// The Prime and Total tiles at the top of Dispatch (v2.99.0). Sums only: nothing here changes a label.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { primeOrdersOfDay, dayLabelTotal } from '../src/lib/dispatch.js'

const batches = [{ id: 'p1', prime: true }, { id: 'p2', prime: true }, { id: 'n1', prime: false }, { id: 'n2' }]
const L = (batch_id, order_key, status, id = `${batch_id}-${order_key}-${Math.random()}`) => ({ id, batch_id, upload_id: 'u1', order_key, status })

test('Prime counts orders, not labels: two parcels of one order are one', () => {
  const labels = [L('p1', 'A', 'ready'), L('p1', 'A', 'ready'), L('p1', 'B', 'dispatched'), L('p2', 'C', 'ready'), L('n1', 'D', 'ready'), L('n2', 'E', 'dispatched')]
  assert.deepEqual(primeOrdersOfDay(batches, labels), { orders: 3, gone: 1 })
})

test('an order has gone only when every parcel of it has; cancelled and on-hold labels are left out', () => {
  const labels = [L('p1', 'A', 'dispatched'), L('p1', 'A', 'ready'), L('p1', 'B', 'dispatched'), L('p1', 'B', 'dispatched'), L('p1', 'C', 'cancelled'), L('p1', 'D', 'held'), L('p2', 'E', 'dispatched'), L('p2', 'E', 'cancelled')]
  assert.deepEqual(primeOrdersOfDay(batches, labels), { orders: 3, gone: 2 })
})

test('labels with no order key are one order each; the same key in another file is another order', () => {
  const labels = [{ id: 'x1', batch_id: 'p1', upload_id: 'u1', status: 'ready' }, { id: 'x2', batch_id: 'p1', upload_id: 'u1', status: 'ready' },
    { id: 'x3', batch_id: 'p1', upload_id: 'u1', order_key: 'A', status: 'ready' }, { id: 'x4', batch_id: 'p2', upload_id: 'u2', order_key: 'A', status: 'ready' }]
  assert.deepEqual(primeOrdersOfDay(batches, labels), { orders: 4, gone: 0 })
})

test('before the day\'s labels arrive (or for another day\'s labels) it uses the batches\' own counts', () => {
  const stat = new Map([['p1', { ready: 5, dispatched: 2 }], ['p2', { ready: 0, dispatched: 3 }], ['n1', { ready: 40, dispatched: 0 }]])
  const statOf = (b) => stat.get(b.id) || { ready: 0, dispatched: 0 }
  assert.deepEqual(primeOrdersOfDay(batches, [], statOf), { orders: 10, gone: 5 })
  assert.deepEqual(primeOrdersOfDay(batches, [L('other-day', 'Z', 'ready')], statOf), { orders: 10, gone: 5 })
  assert.deepEqual(primeOrdersOfDay([{ id: 'n1' }], [L('n1', 'D', 'ready')], statOf), { orders: 0, gone: 0 })   // no Prime that day
  assert.deepEqual(primeOrdersOfDay(), { orders: 0, gone: 0 })
})

test('Total is the carrier tiles added up', () => {
  assert.deepEqual(dayLabelTotal([{ carrier: 'Evri', labels: 300, gone: 120 }, { carrier: 'DHL', labels: 150, gone: 0 }, { carrier: 'Farrall\'s', labels: 4, gone: 4 }]), { labels: 454, gone: 124 })
  assert.deepEqual(dayLabelTotal([]), { labels: 0, gone: 0 })
})
