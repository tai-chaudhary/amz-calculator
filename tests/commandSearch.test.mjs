// ⌘K's database lookup (v2.98.0, migration 126): when it is asked, and how what it finds is shown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeCode, remoteItems, withRemote } from '../src/lib/search.js'

const admin = { role: 'admin', permissions: [] }
const member = (...permissions) => ({ role: 'member', permissions })

test('only numbers and codes are looked up — names and ordinary words never are', () => {
  for (const q of ['204-0707382-5485143', '2040707382', 'OR-RXPNGPX0', '366643105364', '1729942466680429257', 'SCOLA-PVAGLUE-5L', 'RT-0021', 'CP-0038', 'T-0095', ' 12-13579-24680 ', 'H01ABC0012345678'])
    assert.equal(looksLikeCode(q), true, q)
  for (const q of ['', 'pva', 'pva glue', 'pva glue 5l', 'peacock salt 20kg', 'Goods In', 'dispatch', '850g', 'T-12', 'ab12', 'TF9 2DU', 'plenty flexi'])
    assert.equal(looksLikeCode(q), false, q)
})

const found = {
  orders: [
    { ref: '204-1111111-2222222', channel: 'Amazon', labels: 2, cancelled: 0, label_at: '2026-10-14T14:13:10Z', dispatched_at: '2026-10-15T09:54:14Z', what: '20KG PEACOCK WHITE DE-ICING SALT', sold: '2026-10-14', units: 1,
      helm: 'OR-AAAA', helm_open: false, helm_closed: null, pallet: true, returns: ['RT-0007'], cases: ['CP-0003'], claims: ['CL-6981'] },
    { ref: '205-3333333-4444444', channel: 'Amazon', labels: 0, cancelled: 0, label_at: null, dispatched_at: null, what: '2 x Pestshield Fly & Wasp', sold: '2026-08-03', units: 1,
      helm: null, helm_open: false, helm_closed: 'cancelled', pallet: false, returns: [], cases: [], claims: [] },
  ],
  returns: [{ ref: 'RT-0021', order_ref: '204-1111111-2222222', status: 'written_off', at: '2026-11-10T10:00:00Z' }],
  cases: [{ ref: 'CP-0038', order_ref: '204-1111111-2222222', status: 'resolved', kind: 'damaged', product: 'Pyrex Jug', at: '2026-11-11T10:00:00Z' }],
  codes: [{ sku: '366643105364', title: 'Swirl Liquid Jewellery Cleaner', items: [{ qty: 1, code: 'SWIRL', name: 'Swirl Liquid Jewellery Cleaner 145ml', product_id: 'p1' }] },
          { sku: '366000000001', title: 'A set', items: [{ qty: 2, code: 'A', name: 'Bowl', product_id: 'p2' }, { qty: 1, code: 'B', name: 'Jug', product_id: 'p3' }] }],
  tasks: [{ id: 't1', ref: 'T-0095', kind: 'replenish', status: 'done', product: 'Peacock Salt 10kg', from: 'D-2-1-1', to: 'C-3-0-1', qty: 30, done_at: '2026-11-14T00:02:13Z', done_by: 'Sagar' }],
}

test('an order opens Order Audit and says at a glance what happened to it', () => {
  const went = []
  const items = remoteItems(found, { me: admin, go: (p, id) => went.push([p, id]) })
  const [a, b] = items.filter(i => i.type === 'Order')
  assert.equal(a.label, '204-1111111-2222222')
  for (const bit of ['Amazon', 'despatched 15 Oct', '2 labels', 'pallet order', 'return RT-0007', 'case CP-0003', 'claim CL-6981', '20KG PEACOCK']) assert.ok(a.hint.includes(bit), `${bit} in: ${a.hint}`)
  for (const bit of ['sold 3 Aug', 'no label in the portal', 'cancelled in HELM']) assert.ok(b.hint.includes(bit), `${bit} in: ${b.hint}`)
  a.action(); b.action()
  assert.deepEqual(went, [['order-audit', '204-1111111-2222222'], ['order-audit', '205-3333333-4444444']])
})

test('returns, cases, item codes and finished tasks each open in their own place', () => {
  const went = []
  const items = remoteItems(found, { me: admin, go: (p, id) => went.push([p, id]) })
  const of = (type) => items.filter(i => i.type.startsWith(type))
  assert.equal(of('Return')[0].label, 'RT-0021 · 204-1111111-2222222')
  assert.ok(of('Return')[0].hint.startsWith('written off'))
  assert.equal(of('Item code')[0].hint, 'sends 1 × Swirl Liquid Jewellery Cleaner 145ml')
  assert.equal(of('Item code')[1].hint, 'sends 2 × Bowl + 1 × Jug')
  assert.equal(of('Task')[0].type, 'Task (done)')
  assert.ok(of('Task')[0].hint.includes('move 30 from D-2-1-1 to C-3-0-1') && of('Task')[0].hint.includes('by Sagar'))
  for (const i of [of('Return')[0], of('Case')[0], of('Item code')[0], of('Item code')[1], of('Task')[0]]) i.action()
  assert.deepEqual(went, [['returns', 'RT-0021'], ['customer-care', 'CP-0038'], ['inventory', 'p1'], ['inventory', undefined], ['tasks', 't1']])
})

test('a person only gets rows for the pages they can open', () => {
  const types = (me) => [...new Set(remoteItems(found, { me, go() {} }).map(i => i.type.split(' (')[0]))]
  assert.deepEqual(types(member('dispatch', 'goods-in')), [])
  assert.deepEqual(types(member('order-audit')), ['Order'])
  assert.deepEqual(types(member('returns', 'tasks')), ['Return', 'Task'])
  assert.deepEqual(types(admin), ['Order', 'Return', 'Case', 'Item code', 'Task'])
  assert.deepEqual(remoteItems(null, { me: admin, go() {} }), [])
})

test('looked-up rows come first, nothing is listed twice, and the list is capped', () => {
  const local = [{ key: 'dlabel-1' }, { key: 'order-X' }, { key: 'page-dispatch' }]
  const remote = [{ key: 'order-X', fresh: true }, { key: 'order-Y' }]
  assert.deepEqual(withRemote(local, remote).map(i => i.key), ['order-X', 'order-Y', 'dlabel-1', 'page-dispatch'])
  assert.equal(withRemote(local, remote)[0].fresh, true)
  assert.equal(withRemote(local, remote)[0].wrap, true)                 // looked-up rows may run to two lines
  assert.equal(withRemote(local, remote, 3).length, 3)
  assert.deepEqual(withRemote(local, []), local)
})
