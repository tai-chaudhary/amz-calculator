/**
 * Where a listing stands on its way to earning money, and who moved it along.
 */
import { hasComponents } from './calc.js'

export function readiness(p, r, isLive = false) {
  const issue = (...kinds) => (r?.issues || []).some(i => kinds.includes(i.kind))
  const steps = [
    { key: 'stock', label: 'Cost linked to products', done: hasComponents(p) && !issue('missing-component', 'no-cost'),
      hint: hasComponents(p) ? 'A linked product is missing or has no cost' : 'Link it to products so cost changes flow through' },
    { key: 'shipping', label: 'Shipping configured', done: !issue('no-shipping', 'no-rate', 'no-carrier'),
      hint: 'Choose a carrier with a rate set for this service' },
    { key: 'fee', label: 'Amazon fee verified', done: !!p.feeVerified,
      hint: 'Check the fee on Amazon\'s Revenue Calculator from the calculator' },
    { key: 'approved', label: 'Approved', done: p.reviewStatus === 'approved' || isLive, hint: 'Send to review' },
    { key: 'live', label: 'Live', done: isLive, hint: 'Push live once it\'s listed on Amazon' },
  ]
  return { steps, done: steps.filter(s => s.done).length, total: steps.length }
}

export function timeline(p, row) {
  const ev = []
  const add = (at, label, by, note) => at && ev.push({ at, label, by, note })
  add(p.createdAt || row?.created_at, 'Created', p.createdByName)
  add(p.submittedAt, 'Sent for review', p.submittedByName)
  if (p.reviewedAt) {
    add(p.reviewedAt, p.reviewStatus === 'approved' || p.liveAt ? 'Approved' : 'Sent back', p.reviewedByName,
        p.reviewStatus !== 'approved' ? p.reviewNote : null)
  }
  add(p.liveAt, 'Went live', p.liveByName)
  return ev.sort((a, b) => new Date(a.at) - new Date(b.at))
}
