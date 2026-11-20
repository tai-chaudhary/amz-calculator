import test from 'node:test'
import assert from 'node:assert/strict'
import { otherCodesOf, parseCodes, listingCodeKeys, sameListingSku } from '../src/lib/listing.js'

test('other codes: read as a clean list, whatever is stored', () => {
  assert.deepEqual(otherCodesOf({ otherCodes: [' 366601900474 ', '', null, 'PYREX-JUG-GLASS-500ML', '366601900474'] }), ['366601900474', 'PYREX-JUG-GLASS-500ML'])
  assert.deepEqual(otherCodesOf({}), [])
  assert.deepEqual(otherCodesOf({ otherCodes: 'not a list' }), [])
  assert.deepEqual(otherCodesOf(null), [])
})

test('codes typed in a box: commas or new lines, no repeats whatever the case, spaces inside a code kept', () => {
  assert.deepEqual(parseCodes('366601900474, PYREX-JUG-GLASS-500ML\npyrex-jug-glass-500ml ,, '), ['366601900474', 'PYREX-JUG-GLASS-500ML'])
  assert.deepEqual(parseCodes('ScolaArtmix-Assorted Metallic-6x300ml-001'), ['ScolaArtmix-Assorted Metallic-6x300ml-001'])
  assert.deepEqual(parseCodes(''), [])
  assert.deepEqual(parseCodes(undefined), [])
})

test('every code of a listing: the Listing SKU first, upper-cased, once each', () => {
  assert.deepEqual(listingCodeKeys({ listingSku: 'pyrexjug-1000ml-001', otherCodes: ['1729932220365839049', 'PYREXJUG-1000ML-001'] }), ['PYREXJUG-1000ML-001', '1729932220365839049'])
  assert.deepEqual(listingCodeKeys({ otherCodes: [] }), [])
})

test('a code belongs to one listing on a channel: a clash is found on any code, either way round', () => {
  const saved = [
    { id: 'a', name: 'Jug 500ml', data: { channel: 'eBay', listingSku: '366601900474', otherCodes: ['366620801936', 'PYREX-JUG-GLASS-500ML'] } },
    { id: 'b', name: 'Jug 500ml TikTok', data: { channel: 'TikTok', listingSku: 'Pyrexjug-500ml-001', otherCodes: ['PYREX-JUG-GLASS-500ML'] } },
    { id: 'c', name: 'Old one', data: { channel: 'eBay', listingSku: '366620801936', archived: true } },
    { id: 'd', name: 'Amazon jug', data: { listingSku: 'Pyrex Jug 500ml-2 Days' } },
  ]
  // its main code is another listing's other code
  assert.deepEqual(sameListingSku(saved, { channel: 'eBay', listingSku: '366620801936' }).map(r => r.id), ['a'])
  // one of its other codes is another listing's main code
  assert.deepEqual(sameListingSku(saved, { channel: 'eBay', listingSku: 'NEW', otherCodes: ['366601900474'] }).map(r => r.id), ['a'])
  // case does not matter
  assert.deepEqual(sameListingSku(saved, { channel: 'eBay', listingSku: 'pyrex-jug-glass-500ml' }).map(r => r.id), ['a'])
  // the same code on another channel is fine, and so is the listing itself
  assert.deepEqual(sameListingSku(saved, { channel: 'TikTok', listingSku: '366601900474' }), [])
  assert.deepEqual(sameListingSku(saved, saved[0].data, 'a'), [])
  // Amazon is as it was: only the Listing SKU, on Amazon listings
  assert.deepEqual(sameListingSku(saved, { listingSku: 'pyrex jug 500ml-2 days' }).map(r => r.id), ['d'])
  assert.deepEqual(sameListingSku(saved, { listingSku: '' }), [])
})
