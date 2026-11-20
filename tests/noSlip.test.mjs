// v2.94.0 — labels with no packing slip: HELM's order offered for one click, the mismatch tick, and why it is going out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { helmGuessAsks, applyHelmGuess, contentsDiffer, contentsText, manualHold, hasManual, manualSlip, planUpload } from '../src/lib/dispatch.js'

const label = (postcode, extra = {}) => ({ carrier: 'Evri', service: 'Next Day', tracking: 'T' + postcode.replace(/\W/g, ''), customer: 'A Customer', postcode, pageIndex: 0, ...extra })
const slip = { channelRef: '111-1111111-1111111', helmOrder: 'H1', slipId: '', items: [{ code: 'JUG', name: 'Jug', qty: 1 }], customer: 'B', postcode: 'ZZ1 1ZZ' }
const withSlip = { labels: [label('ZZ1 1ZZ')], slip }
const loose = (pc) => ({ labels: [label(pc)], slip: null })
const helmOrder = (ref, postcode, items, extra = {}) => ({ ref, channel: 'Amazon', postcode, items, closed: false, prime: false, ...extra })
const BAGS12 = [{ code: 'TIDYZ-HB-X12', name: '12 X TidyZ Handy Bags', qty: 1 }]
// what each code really is: the 12-pack listing code is twelve of the inventory product
const codeInfo = new Map([
  ['TIDYZHBX12', { status: 'verified', items: [{ code: 'TIDYZ-HB', name: 'TidyZ Handy Bags', qty: 12 }] }],
  ['TIDYZHB', { status: 'own', items: [{ code: 'TIDYZ-HB', name: 'TidyZ Handy Bags', qty: 1 }] }],
  ['JUG', { status: 'own', items: [{ code: 'JUG', name: 'Jug', qty: 1 }] }],
])

test('only labels with no slip are asked about, each postcode once', () => {
  assert.deepEqual(helmGuessAsks([withSlip, loose('AB1 2CD'), loose('AB1 2CD'), loose('EF3 4GH'), { labels: [label('')], slip: null }]), ['AB1 2CD', 'EF3 4GH'])
  assert.deepEqual(helmGuessAsks([withSlip, withSlip]), [])
})

test('a file where every label has a slip is returned untouched, object for object', () => {
  const orders = [withSlip, { ...withSlip }]
  const out = applyHelmGuess(orders, { 'ZZ1 1ZZ': [helmOrder('X', 'ZZ1 1ZZ', BAGS12)] })
  assert.equal(out[0], orders[0]); assert.equal(out[1], orders[1])
  assert.equal(applyHelmGuess(orders, null), orders)               // the lookup failed: the very same list
})

test('HELM\'s order is offered when the postcode is the same or one character out — never further', () => {
  const orders = [withSlip, loose('AB1 2CD'), loose('AB1 2C0'), loose('EF3 4GH'), loose('QQ9 9QQ')]
  const found = {
    'AB1 2CD': [helmOrder('200-1', 'AB1 2CD', BAGS12)],
    'AB1 2C0': [helmOrder('200-2', 'AB1 2CQ', BAGS12), helmOrder('200-3', 'AB1 2CX', BAGS12)],   // O, 0 and Q read alike; X is a wrong character
    'EF3 4GH': [helmOrder('200-4', 'EF3 9XX', BAGS12), helmOrder('', 'EF3 4GH', BAGS12), helmOrder('200-5', 'EF3 4GH', [{ code: '', qty: 1 }])],
  }
  const out = applyHelmGuess(orders, found)
  assert.equal(out[0], orders[0])
  assert.deepEqual(out[1].helm.map(h => [h.ref, h.exact]), [['200-1', true]])
  assert.deepEqual(out[2].helm.map(h => [h.ref, h.exact]), [['200-2', true], ['200-3', false]])   // exact first
  assert.equal(out[3], orders[3])                                 // two characters out, no order number, or contents unknown: nothing offered
  assert.equal(out[4], orders[4])                                 // HELM has nothing
  assert.deepEqual(out[1].helm[0].items, [{ code: 'TIDYZ-HB-X12', name: '12 X TidyZ Handy Bags', qty: 1 }])
  assert.equal(out[1].slip, null)                                 // offered, never filled in by itself
})

test('contents are compared as what leaves the shelf, not as codes', () => {
  // one 12-pack listing = twelve singles
  assert.equal(contentsDiffer(BAGS12, [{ code: 'TIDYZ-HB', name: 'TidyZ Handy Bags', qty: '12' }], codeInfo), false)
  assert.equal(contentsDiffer(BAGS12, [{ code: 'TIDYZ-HB', name: 'TidyZ Handy Bags', qty: '1' }], codeInfo), true)     // the TidyZ mistake
  assert.equal(contentsDiffer(BAGS12, [{ code: 'JUG', name: 'Jug', qty: '12' }], codeInfo), true)                    // wrong product
  assert.equal(contentsDiffer(BAGS12, [{ code: 'TIDYZ-HB', qty: '12' }, { code: 'JUG', qty: '1' }], codeInfo), true) // something extra
  assert.equal(contentsDiffer([{ code: 'JUG', qty: 2 }, { code: 'JUG', qty: 2 }], [{ code: 'jug', qty: '4' }], codeInfo), false)
  // codes nobody knows stand for themselves
  assert.equal(contentsDiffer([{ code: 'NEW-1', qty: 2 }], [{ code: 'NEW-1', qty: 2 }], null), false)
  assert.equal(contentsDiffer([{ code: 'NEW-1', qty: 2 }], [{ code: 'NEW-1', qty: 3 }], null), true)
  assert.equal(contentsText([{ code: 'A', name: 'Jug', qty: '2' }, { code: 'B', qty: 1 }, { code: '', qty: 3 }]), '2 × Jug + 1 × B')
})

test('what is still needed before a label with no slip goes through', () => {
  const helm = [{ ref: '200-1234567', items: BAGS12 }]
  const items = [{ code: 'TIDYZ-HB', name: 'TidyZ Handy Bags', qty: '1' }]
  assert.equal(manualHold(null), null)
  assert.equal(manualHold({ items: [] }), null)                                     // nothing chosen yet: nothing to hold
  assert.equal(manualHold({ items }), 'Say why it is going out')
  assert.equal(manualHold({ items, reason: 'replacement' }), 'Give the order it replaces')
  assert.equal(manualHold({ items, reason: 'replacement', originalRef: '200-9999999' }), null)
  assert.equal(manualHold({ items, reason: 'manual' }), 'Say who it is for and why')
  assert.equal(manualHold({ items, reason: 'manual', note: '  ' }), 'Say who it is for and why')
  assert.equal(manualHold({ items, reason: 'manual', note: 'Sample for a buyer' }), null)
  assert.equal(manualHold({ items, reason: 'other', note: 'Photo shoot' }), null)
  assert.equal(manualHold({ items, reason: 'order' }), 'Give the order number')
  assert.equal(manualHold({ items, reason: 'order', amazonRef: '12' }), 'Give the order number')
  assert.equal(manualHold({ items, reason: 'order', amazonRef: '300-7777777' }), null)                              // an order HELM offered nothing for
  // HELM's own order, and what was chosen is not what HELM says
  assert.match(manualHold({ items, reason: 'order', amazonRef: '200-1234567' }, { helm, codeInfo }), /Different from HELM/)
  assert.equal(manualHold({ items, reason: 'order', amazonRef: '200-1234567', sure: true }, { helm, codeInfo }), null)
  assert.equal(manualHold({ items: [{ code: 'TIDYZ-HB', qty: '12' }], reason: 'order', amazonRef: '200-1234567' }, { helm, codeInfo }), null)
  assert.equal(manualHold({ items: BAGS12.map(i => ({ ...i, qty: String(i.qty) })), reason: 'order', amazonRef: '200-1234567' }, { helm, codeInfo }), null)   // Confirm
})

test('a held entry keeps its label waiting; entries from before (no hold) behave as they did', () => {
  const items = [{ code: 'JUG', name: 'Jug', qty: '1' }]
  assert.equal(hasManual({ items, reason: 'replacement' }), true)                    // Order Audit's replacement, as before
  assert.equal(hasManual({ items }), true)                                           // an older entry with no reason, as before
  assert.equal(hasManual({ items, hold: 'Say why it is going out' }), false)
  assert.equal(hasManual({ items: [], hold: null }), false)
  const orders = [loose('AB1 2CD')]
  const held = planUpload(orders, [], { manual: { o0: { items, hold: 'Say why it is going out' } }, codeInfo })
  const nothing = planUpload(orders, [], { manual: {}, codeInfo })
  assert.equal(held.needsYou, nothing.needsYou)                                      // waiting, exactly as if nothing had been said
  assert.ok(held.needsYou > 0)
})

test('a confirmed order is saved as an order with its number, not as a replacement', () => {
  const s = manualSlip(label('AB1 2CD'), { items: BAGS12.map(i => ({ ...i, qty: '1' })), reason: 'order', amazonRef: '200-1' })
  assert.equal(s.reason, 'order'); assert.equal(s.channelRef, '200-1'); assert.equal(s.originalRef, '')
  assert.deepEqual(s.items, [{ code: 'TIDYZ-HB-X12', name: '12 X TidyZ Handy Bags', qty: 1 }])
  const r = manualSlip(label('AB1 2CD'), { items: [{ code: 'JUG', name: 'Jug', qty: '1' }], reason: 'replacement', originalRef: '200-9', note: 'arrived broken' })
  assert.equal(r.reason, 'replacement'); assert.equal(r.channelRef, '200-9'); assert.equal(r.originalRef, '200-9')
})
