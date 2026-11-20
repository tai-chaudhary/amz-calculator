// The fulfilment share on an overhead (v2.100.0, migration 127)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fulfilmentShare, fulfilmentWord, shareOn } from '../src/lib/overheads.js'

test('the share is kept between 0 and 100 and read safely', () => {
  assert.equal(fulfilmentShare({ fulfilment_share: 100 }), 100)
  assert.equal(fulfilmentShare({ fulfilment_share: '50.00' }), 50)
  assert.equal(fulfilmentShare({ fulfilment_share: 0 }), 0)
  assert.equal(fulfilmentShare({}), 0)                 // an older copy of the list, before the column existed
  assert.equal(fulfilmentShare(null), 0)
  assert.equal(fulfilmentShare({ fulfilment_share: 140 }), 100)
  assert.equal(fulfilmentShare({ fulfilment_share: -5 }), 0)
})

test('said in words', () => {
  assert.equal(fulfilmentWord(0), 'Not counted')
  assert.equal(fulfilmentWord(null), 'Not counted')
  assert.equal(fulfilmentWord(100), 'All of it')
  assert.equal(fulfilmentWord('50.00'), '50% of it')
  assert.equal(fulfilmentWord(33.33), '33.33% of it')
})

// v2.101.0 — the share is dated: each applies from its date until the next
test('the share in force on a day is the latest one dated on or before it', () => {
  const shares = [{ from_date: '2026-12-01', share: 0, at: '3' }, { from_date: '2026-11-01', share: '50.00', at: '2' }, { from_date: '2026-08-20', share: 100, at: '1' }]
  assert.equal(shareOn(shares, '2026-08-19'), 0)        // before the first one: not counted
  assert.equal(shareOn(shares, '2026-08-20'), 100)
  assert.equal(shareOn(shares, '2026-10-31'), 100)      // October keeps what it was
  assert.equal(shareOn(shares, '2026-11-01'), 50)
  assert.equal(shareOn(shares, '2026-11-30'), 50)
  assert.equal(shareOn(shares, '2026-12-01'), 0)
  assert.equal(shareOn(shares, '2027-06-01'), 0)
  assert.equal(shareOn([], '2026-11-01'), 0)
  assert.equal(shareOn(undefined, '2026-11-01'), 0)
  assert.equal(shareOn([...shares].reverse(), '2026-11-15'), 50)                 // whatever order they arrive in
})
