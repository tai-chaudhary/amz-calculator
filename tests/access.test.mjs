// Costs are for Purchasing only. The app and the database must agree on what "Purchasing" is.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PURCHASING, COST_FREE, NAV, LOCKABLE, seesCosts, needsCosts } from '../src/lib/access.js'

test('sees_costs() in the latest migration uses the same Purchasing list', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const latest = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .filter(f => /function public\.sees_costs\(\)/.test(readFileSync(new URL(f, dir), 'utf8'))).pop()
  const sql = readFileSync(new URL(latest, dir), 'utf8')
  const list = sql.match(/permissions \?\| array\[([^\]]*)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1))
  assert.deepEqual([...list].sort(), [...PURCHASING].sort(), `${latest} and src/lib/access.js differ`)
})

test('every listed page is a real page', () => {
  for (const id of [...PURCHASING, ...COST_FREE]) assert.ok(NAV.some(n => n.id === id), id)
})

test('only Purchasing sees costs', () => {
  const m = (permissions) => ({ role: 'member', active: true, permissions })
  assert.equal(seesCosts(m(['dispatch', 'dispatch-dashboard', 'requests', 'goods-in', 'inventory', 'tasks', 'print-station', 'returns'])), false) // Ankesh, Sagar
  assert.equal(seesCosts(m(['dispatch', 'goods-in', 'inventory', 'tasks', 'tracking', 'link-codes', 'customer-care', 'claims', 'returns', 'order-audit', 'cancel-labels'])), false) // Jignesh
  assert.equal(seesCosts(m(['calculator', 'saved'])), false)   // cost pages alone don't open costs
  assert.equal(seesCosts(m(['payments'])), true)               // accounts
  assert.equal(seesCosts({ role: 'admin', active: true, permissions: [] }), true)
})

test('a page not marked cost-free needs Purchasing (safe default for new pages)', () => {
  assert.equal(needsCosts('calculator'), true)
  assert.equal(needsCosts('some-new-page'), true)
  assert.equal(needsCosts('claims'), false)
  assert.ok(LOCKABLE.filter(p => needsCosts(p.id)).length > 10)
})
