import test from 'node:test'
import assert from 'node:assert/strict'
import { CASE_ACTIONS, toggleAction, daysHeld, replacementStage, replacementOpen, sendText, replacementProblem } from '../src/lib/careReplacements.js'

test('actions taken on a case: ticked and unticked, kept in a fixed order, each logged', () => {
  assert.deepEqual(Object.values(CASE_ACTIONS), ['Responded to buyer', 'Awaiting buyer response', 'Offered refund or replacement'])
  let r = toggleAction([], 'offered')
  assert.deepEqual(r, { actions: ['offered'], what: 'Action taken: Offered refund or replacement', added: true })
  r = toggleAction(r.actions, 'responded')
  assert.deepEqual(r.actions, ['responded', 'offered'])
  r = toggleAction(r.actions, 'offered')
  assert.deepEqual(r, { actions: ['responded'], what: 'Removed: Offered refund or replacement', added: false })
  assert.deepEqual(toggleAction(null, 'awaiting_buyer').actions, ['awaiting_buyer'])
})

test('held at depot: days since the date given', () => {
  assert.equal(daysHeld('2026-11-12', '2026-11-19'), 7)
  assert.equal(daysHeld('2026-11-19', '2026-11-19'), 0)
  assert.equal(daysHeld('2026-10-30', '2026-11-02'), 3)
  assert.equal(daysHeld(null, '2026-11-19'), null)
  assert.equal(daysHeld('2026-11-20', '2026-11-19'), null)
})

test('a replacement request: where it has got to, read from its Dispatch labels', () => {
  const q = { id: 'r1', status: 'requested' }
  assert.equal(replacementStage(q, []), 'requested'); assert.equal(replacementOpen(q, []), true)
  assert.equal(replacementStage({ id: 'r1', status: 'declined' }, []), 'declined'); assert.equal(replacementOpen({ id: 'r1', status: 'declined' }, []), false)
  const ok = { id: 'r1', status: 'approved' }
  assert.equal(replacementStage(ok, []), 'approved')
  // the label was uploaded here but Dispatch's copy has not been read back yet
  assert.equal(replacementStage({ ...ok, upload_id: 'u1' }, []), 'uploaded')
  // another request's labels are not this one's
  assert.equal(replacementStage(ok, [{ request_id: 'other', status: 'dispatched' }]), 'approved')
  const ready = { request_id: 'r1', status: 'ready' }, gone = { request_id: 'r1', status: 'dispatched', dispatched_at: '2026-11-19T10:00:00Z' }
  assert.equal(replacementStage(ok, [ready]), 'uploaded')
  assert.equal(replacementStage(ok, [gone]), 'dispatched')
  // two parcels: dispatched only when both have gone, delivered only when both have arrived
  assert.equal(replacementStage(ok, [gone, ready]), 'uploaded'); assert.equal(replacementOpen(ok, [gone, ready]), true)
  assert.equal(replacementStage(ok, [gone, { ...gone, delivered_at: '2026-11-20T09:00:00Z' }]), 'dispatched')
  assert.equal(replacementStage(ok, [{ ...gone, delivered_at: 'x' }, { ...gone, delivered_at: 'y' }]), 'delivered')
  assert.equal(replacementOpen(ok, [gone]), false)
})

test('a replacement request needs an order, something to send and a reason', () => {
  assert.equal(sendText([{ name: 'Pyrex Jug 1L', qty: 2 }, { code: 'SALT-25', qty: 1 }]), '2 × Pyrex Jug 1L, SALT-25')
  const order = { order_ref: '204-1' }, items = [{ code: 'A', name: 'A', qty: 1 }]
  assert.equal(replacementProblem({ order: null, items, why: 'x' }), 'Find the order first')
  assert.equal(replacementProblem({ order, items: [], why: 'x' }), 'Tick what to send')
  assert.equal(replacementProblem({ order, items: [{ code: 'A', qty: 0 }], why: 'x' }), 'Give a quantity for each product')
  assert.equal(replacementProblem({ order, items, why: '  ' }), 'Say why it is needed')
  assert.equal(replacementProblem({ order, items, why: 'arrived cracked' }), null)
})

test('a replacement label uploaded from 5pm goes to Dispatch for the next working day (Monday to Saturday)', async () => {
  const { replacementShipDate } = await import('../src/lib/careReplacements.js')
  const { nextWorkingDay } = await import('../src/lib/dispatch.js')
  const at = (iso) => replacementShipDate(new Date(iso))
  // Wednesday 18 Nov 2026 (GMT, so London time is UTC)
  assert.deepEqual(at('2026-11-18T16:59:00Z'), { date: '2026-11-18', moved: false, today: '2026-11-18' })
  assert.deepEqual(at('2026-11-18T17:00:00Z'), { date: '2026-11-19', moved: true, today: '2026-11-18' })
  assert.equal(at('2026-11-18T17:30:00Z').date, '2026-11-19')        // the owner's example: Wednesday 5:30pm → Thursday
  assert.equal(at('2026-11-18T23:59:00Z').date, '2026-11-19')
  assert.equal(at('2026-11-19T00:05:00Z').date, '2026-11-19')        // just after midnight is that day
  assert.equal(at('2026-11-20T17:30:00Z').date, '2026-11-21')        // Friday evening → Saturday (a working day)
  assert.equal(at('2026-11-21T12:00:00Z').date, '2026-11-21')        // Saturday midday → Saturday
  assert.equal(at('2026-11-21T17:30:00Z').date, '2026-11-23')        // the owner's example: Saturday 5:30pm → Monday
  assert.deepEqual(at('2026-11-22T10:00:00Z'), { date: '2026-11-23', moved: true, today: '2026-11-22' })   // Sunday, any time → Monday
  assert.equal(at('2026-12-31T18:00:00Z').date, '2027-01-01')        // over the year end
  // in summer London is an hour ahead of UTC: 16:30 UTC is 5:30pm there
  assert.equal(at('2026-07-15T15:59:00Z').date, '2026-07-15'); assert.equal(at('2026-07-15T16:30:00Z').date, '2026-07-16')
  assert.equal(at('2026-07-18T23:30:00Z').date, '2026-07-20')        // 00:30 on a Sunday in London → Monday
  // the same "next working day" as Dispatch's own
  for (const d of ['2026-11-18', '2026-11-20', '2026-11-21', '2026-12-31']) assert.equal(at(`${d}T18:00:00Z`).date, nextWorkingDay(d))
})
