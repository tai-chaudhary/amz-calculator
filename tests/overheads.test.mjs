import test from 'node:test'
import assert from 'node:assert/strict'
import { costBetween, amountOn, dayCost, monthlyEquivalent, daysInMonth, monthEnd, addMonths, partMonthNote, runningForPlan } from '../src/lib/overheads.js'

// The same cases that were run against the database functions (migrations 104 and 105) on 15 Nov 2026.
const rent = { start_date: '2026-08-15', end_date: null, amounts: [{ from_date: '2026-08-15', amount: 3100, every: 'month' }] }

test('a part month is charged by days', () => {
  assert.deepEqual(costBetween(rent, '2026-08-01', '2026-08-31'), { cost: 1700, days: 17 })
  assert.deepEqual(costBetween(rent, '2026-08-15', '2026-08-15'), { cost: 100, days: 1 })
})
test('a whole month is the monthly amount, whatever its length', () => {
  assert.equal(costBetween(rent, '2026-09-01', '2026-09-30').cost, 3100)
  assert.equal(costBetween(rent, '2026-10-01', '2026-10-31').cost, 3100)
  assert.equal(costBetween(rent, '2027-02-01', '2027-02-28').cost, 3100)
  assert.equal(costBetween(rent, '2028-02-01', '2028-02-29').cost, 3100)
})
test('nothing before it starts', () => {
  assert.deepEqual(costBetween(rent, '2026-07-01', '2026-08-14'), { cost: 0, days: 0 })
})
test('a change of amount applies from its date; earlier days keep the old amount', () => {
  const r = { ...rent, amounts: [...rent.amounts, { from_date: '2026-10-16', amount: 3300, every: 'month' }] }
  assert.equal(costBetween(r, '2026-10-01', '2026-10-31').cost, 3203.23)
  assert.equal(costBetween(r, '2026-09-01', '2026-09-30').cost, 3100)
  assert.equal(amountOn(r.amounts, '2026-10-15').amount, 3100)
  assert.equal(amountOn(r.amounts, '2026-10-16').amount, 3300)
})
test('the last day is charged, the day after is not', () => {
  const r = { ...rent, end_date: '2026-11-10', amounts: [{ from_date: '2026-08-15', amount: 3300, every: 'month' }] }
  assert.deepEqual(costBetween(r, '2026-11-01', '2026-11-30'), { cost: 1100, days: 10 })
  assert.equal(costBetween(r, '2026-11-11', '2026-11-30').cost, 0)
})
test('several months add up', () => {
  const r = { start_date: '2026-08-15', end_date: '2026-11-10', amounts: [{ from_date: '2026-08-15', amount: 3100, every: 'month' }, { from_date: '2026-10-16', amount: 3300, every: 'month' }] }
  assert.equal(costBetween(r, '2026-08-01', '2026-11-30').cost, 9103.23)
})
test('month helpers', () => {
  assert.equal(daysInMonth('2026-02-10'), 28)
  assert.equal(monthEnd('2026-11-03'), '2026-11-30')
  assert.equal(addMonths('2026-12-01', 1), '2027-01-01')
  assert.equal(addMonths('2026-01-01', -1), '2025-12-01')
  assert.equal(partMonthNote(17, '2026-08-01'), '17 of 31 days')
  assert.equal(partMonthNote(31, '2026-08-01'), '')
})
test('Build a Month only starts from what is running today', () => {
  const out = runningForPlan([
    { id: 'a', name: 'Rent', status: 'running', monthly_now: '7000.00', category: 'office' },
    { id: 'b', name: 'Old tool', status: 'ended', monthly_now: '30.00', category: 'software' },
    { id: 'c', name: 'New hire', status: 'upcoming', monthly_now: '2000.00', category: 'staff' },
  ])
  assert.deepEqual(out, [{ id: 'a', name: 'Rent', amount: 7000, categoryId: 'office' }])
})

test('weekly: a seventh for each day', () => {
  const w = { start_date: '2026-11-09', amounts: [{ from_date: '2026-11-09', amount: 700, every: 'week' }] }
  assert.deepEqual(costBetween(w, '2026-11-01', '2026-11-30'), { cost: 2200, days: 22 })
  assert.equal(costBetween(w, '2026-12-01', '2026-12-31').cost, 3100)
})
test('quarterly: a whole calendar quarter is the amount, a month is its share of the days', () => {
  const q = { start_date: '2026-10-01', amounts: [{ from_date: '2026-10-01', amount: 9200, every: 'quarter' }] }
  assert.equal(costBetween(q, '2026-10-01', '2026-12-31').cost, 9200)
  assert.equal(costBetween(q, '2026-10-01', '2026-10-31').cost, 3100)
  assert.equal(costBetween(q, '2026-11-01', '2026-11-30').cost, 3000)
  assert.equal(costBetween(q, '2027-01-01', '2027-01-31').cost, 3168.89)
})
test('yearly: a whole year is the amount, leap years included', () => {
  const y = { start_date: '2026-01-01', amounts: [{ from_date: '2026-01-01', amount: 3650, every: 'year' }] }
  assert.equal(costBetween(y, '2026-01-01', '2026-12-31').cost, 3650)
  assert.equal(costBetween(y, '2026-11-01', '2026-11-30').cost, 300)
  assert.equal(costBetween(y, '2028-02-01', '2028-02-29').cost, 289.21)
})
test('the frequency can change with the amount, from a date', () => {
  const w = { start_date: '2026-11-09', amounts: [{ from_date: '2026-11-09', amount: 700, every: 'week' }, { from_date: '2026-12-01', amount: 3000, every: 'month' }] }
  assert.equal(costBetween(w, '2026-11-01', '2026-11-30').cost, 2200)
  assert.equal(costBetween(w, '2026-12-01', '2026-12-31').cost, 3000)
})
test('one day, and an average month', () => {
  assert.equal(dayCost(700, 'week', '2026-11-09'), 100)
  assert.equal(dayCost(9200, 'quarter', '2026-11-09'), 100)
  assert.equal(monthlyEquivalent(700, 'week'), 3033.33)
  assert.equal(monthlyEquivalent(9200, 'quarter'), 3066.67)
  assert.equal(monthlyEquivalent(3650, 'year'), 304.17)
  assert.equal(monthlyEquivalent(3100, 'month'), 3100)
})
test('amounts saved before frequencies existed still read as monthly', () => {
  assert.deepEqual(amountOn([{ from_date: '2026-08-01', monthly: '250.00' }], '2026-09-01'), { amount: 250, every: 'month' })
})
