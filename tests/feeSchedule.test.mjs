// The database holds a copy of Amazon's fee schedule (migration 117) so that fees it estimates follow a listing's fee
// category. This test fails when src/lib/feeSchedule.js and that copy drift apart. To put it right: write a new
// migration that re-seeds public.fee_categories from FEE_CATEGORIES (same shape as 117's insert) and point SEED at it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { FEE_CATEGORIES, DIGITAL_SERVICES_FEE, referralFeeFor, findFeeCategory } from '../src/lib/feeSchedule.js'

const SEED = new URL('../supabase/migrations/117_fee_schedule_in_database.sql', import.meta.url)
const sql = fs.readFileSync(SEED, 'utf8')

test('the database copy of the fee schedule matches the app', () => {
  const rows = [...sql.matchAll(/^\s+\('((?:[^']|'')+)', '(\{.*\})'::jsonb\),?$/gm)].map(m => ({ name: m[1].replace(/''/g, "'"), ...JSON.parse(m[2].replace(/''/g, "'")) }))
  assert.equal(rows.length, FEE_CATEGORIES.length, 'same number of categories')
  for (const c of FEE_CATEGORIES) {
    const r = rows.find(x => x.name === c.name)
    assert.ok(r, `${c.name} is in the database copy`)
    assert.deepEqual(r, c, `${c.name} is the same in both`)
  }
})

test('the database works the fee out the way the app does', () => {
  // the migration carries the app's own answers and refuses to apply if the database disagrees with any of them
  const checks = [...sql.matchAll(/\('((?:[^']|'')+)',([0-9.]+),([0-9.]+)\)/g)].map(m => [m[1].replace(/''/g, "'"), +m[2], +m[3]])
  assert.ok(checks.length >= 150, 'the checks are in the migration')
  for (const [name, price, want] of checks) assert.ok(Math.abs(referralFeeFor(findFeeCategory(name), price) - want) < 1e-5, `${name} at £${price}`)
  assert.ok(sql.includes(`return fee * ${1 + DIGITAL_SERVICES_FEE};`), 'the digital services fee is the same')
})
