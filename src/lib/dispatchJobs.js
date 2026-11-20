/**
 * Uploads read in the background. Reading a file of picture labels takes a
 * while, so it runs here — outside any screen — and the rest of the portal
 * stays free to use. When it's done, a file with nothing to sort out is saved
 * as a batch straight away; anything else waits for a quick review.
 *
 * Jobs live for as long as the browser tab is open.
 */
import { readDispatchFile, releaseOcr } from './dispatchPdf'
import { pairPages, planUpload, londonDate, amazonAsks, applyAmazon, helmGuessAsks, applyHelmGuess } from './dispatch'
import { loadDispatchMappings, findExistingOrders, saveDispatchUpload, findCustomerHistory, loadItemUnits, loadCodeInfo, markReplacement, bulkUploadCheck, loadPrimeOrders, loadPremiumOrders, loadAmazonOrders, loadNoSlipOrders } from './db'
import { bulkCandidates, applyBulkLinks, existingForUpload } from './bulkOrders'

let jobs = []
const listeners = new Set()
const emit = () => { jobs = [...jobs]; listeners.forEach(fn => fn(jobs)) }

export function subscribeJobs(fn) {
  listeners.add(fn); fn(jobs)
  return () => listeners.delete(fn)
}
export const currentJobs = () => jobs

/** Which job updates someone has already been told about (on screen or by a toast). */
export const toldJobs = new Map()

function patch(id, changes) {
  jobs = jobs.map(j => (j.id === id ? { ...j, ...changes } : j)); emit()
}
export const updateJob = patch
export function dismissJob(id) {
  jobs = jobs.filter(j => j.id !== id); emit()
}

/** Starts reading a file. meta: { title, me, onLog, shipDate, prime, premium } — who picks it is asked at printing; prime / premium = the office ticked "These are Prime orders" / "These are Premium orders" */
export function startJob(file, meta = {}) {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  jobs = [...jobs, { id, file, name: file.name, meta, status: 'reading', progress: null, startedAt: Date.now() }]
  emit()
  // Holding a lock tells the browser this tab is busy, so it isn't frozen or put to sleep in the background
  const work = () => run(id)
  const running = (typeof navigator !== 'undefined' && navigator.locks?.request)
    ? navigator.locks.request(`dispatch-reading-${id}`, work)
    : work()
  Promise.resolve(running).finally(() => { if (!jobs.some(j => j.status === 'reading' || j.status === 'saving')) releaseOcr() })
  return id
}

async function run(id) {
  const job = jobs.find(j => j.id === id)
  try {
    // Wholesale orders come already known (typed in, label made here): nothing to read off the file
    const preset = job.meta.preset
    const { pages, bytes } = preset
      ? { pages: Array.from({ length: preset.pageCount }, (_, i) => ({ index: i })), bytes: new Uint8Array(await job.file.arrayBuffer()) }
      : await readDispatchFile(job.file, (progress) => patch(id, { progress }))
    let paired = preset ? { orders: preset.orders } : pairPages(pages)
    // Bulk orders: an order sent mostly by pallet has one parcel label for the tracking number. Its slip still says the
    // whole order, so it's read as the parcel's share here (see bulkOrders.js) — otherwise it would be held as
    // "20 units, one label". If the check can't be made, nothing changes and Dispatch's own checks decide as before.
    if (!preset) {
      try {
        const cands = bulkCandidates(paired.orders)
        if (cands.length) {
          const links = await bulkUploadCheck(cands)
          if (links?.length) paired = { ...paired, orders: applyBulkLinks(paired.orders, links).orders }
        }
      } catch { /* not a reason to stop an upload */ }
    }
    // Amazon Buy Shipping (v2.89.0): a label that came with Amazon's own packing slip. HELM's record of the order says
    // what is in it (and proves the order number was read right); failing that the portal's listing suggests it for
    // one click; failing that a person says, as before. If the check can't be made, they are labels with no slip, as before.
    if (!preset) {
      try {
        const asks = amazonAsks(paired.orders)
        if (asks.length) paired = { ...paired, orders: applyAmazon(paired.orders, await loadAmazonOrders(asks)) }
      } catch { /* not a reason to stop an upload */ }
    }
    // Labels with no packing slip (v2.94.0): the unlabelled HELM order at that postcode, offered for one click on the
    // review screen. Asked only when a file has such labels; if it can't be asked they are labels with no slip, as before.
    if (!preset && !job.meta.manualAll) {
      try {
        const pcs = helmGuessAsks(paired.orders)
        if (pcs.length) paired = { ...paired, orders: applyHelmGuess(paired.orders, await loadNoSlipOrders(pcs)) }
      } catch { /* not a reason to stop an upload */ }
    }
    const refs = paired.orders.flatMap(o => [o.slip?.channelRef, o.slip?.helmOrder, o.slip?.slipId]).filter(Boolean)
    // Tracking numbers too: a label with no slip has nothing else to tell a repeat upload by
    const tracks = paired.orders.flatMap(o => (o.labels || []).map(l => l.tracking)).filter(Boolean)
    // Labels with no slip: what's been sent to that address before suggests what this is
    const loosePostcodes = paired.orders.filter(o => !o.slip).map(o => o.labels[0]?.postcode).filter(Boolean)
    // Prime (v2.87.0): which of these orders HELM has tagged Prime. If it can't be checked the upload carries on
    // exactly as it would have, and the review screen says Prime wasn't checked.
    const primeRefs = paired.orders.flatMap(o => [o.slip?.channelRef, o.slip?.helmOrder, ...(o.labels || []).map(l => l.slipRef)]).filter(Boolean)
    const [mappings, existing, history, units, primeFound, premiumFound] = await Promise.all([
      loadDispatchMappings().catch(() => []),
      // A pallet's labels and its order's parcel label share the channel order number: neither is a repeat of the other
      findExistingOrders(refs, tracks).then(rows => existingForUpload(rows, { pallet: !!preset })).catch(() => []),
      findCustomerHistory(loosePostcodes).catch(() => []),
      loadItemUnits().catch(() => []),
      loadPrimeOrders(primeRefs, loosePostcodes).catch(() => null),
      // Premium (v2.110.0): the same, for orders HELM has tagged Premium
      loadPremiumOrders(primeRefs, loosePostcodes).catch(() => null),
    ])
    const prime = { refs: primeFound?.refs || new Set(), postcodes: primeFound?.postcodes || new Set(), all: !!job.meta.prime, checked: !!primeFound }
    const premium = { refs: premiumFound?.refs || new Set(), postcodes: premiumFound?.postcodes || new Set(), all: !!job.meta.premium, checked: !!premiumFound }
    // HELM's product list: any item code not in it means the slip was misread
    const helmCodes = new Set(units.filter(u => u.source === 'helm').map(u => u.code_key))
    const read = { pages, bytes, ...paired }
    const unitsByCode = new Map(units.map(u => [u.code_key, u]))
    // What every code is — ours, verified, or not yet — so stamps come from inventory, never typed.
    // Codes in mappings too: a label with no slip is told what it is from one of those
    const codes = [...paired.orders.flatMap(o => (o.slip?.items || []).map(i => i.code)), ...mappings.flatMap(m => (m.items || []).map(i => i.code)),
      ...((job.meta.manualAll?.items || []).map(i => i.code)), ...paired.orders.flatMap(o => (o.helm || []).flatMap(h => h.items.map(i => i.code)))]
    const codeInfo = await loadCodeInfo(codes)
    // A replacement arranged from Order Audit: labels with no packing slip are what the person chose
    const ma = job.meta.manualAll
    const manual = ma ? Object.fromEntries(paired.orders.map((o, i) => [`o${i}`, o.slip ? null : { items: ma.items, reason: 'replacement', note: ma.note || '', originalRef: ma.originalRef || '' }]).filter(([, v]) => v)) : {}
    const plan = planUpload(paired.orders, mappings, { existing, helmCodes, unitsByCode, codeInfo, manual, prime, premium })

    // Nothing for a person to decide: save it as a batch now
    if (plan.needsYou === 0 && (plan.batches.length || plan.heldBack.length)) {
      patch(id, { status: 'saving', read, existing, history })
      const { me, picker, title, onLog } = job.meta
      // Waiting in On hold, in this batch, saying exactly why (codes to verify, boxes to fill)
      const held = plan.heldBack.map(o => ({ ...o, holdReason: o.problems.map(p => p.text).join('; ') || 'Held back at upload to check' }))
      const result = await saveDispatchUpload({
        file: job.file, bytes, pageCount: pages.length, batches: plan.batches, held, me, shipDate: job.meta.shipDate || londonDate(), picker, title,
      })
      // Every label in it is a replacement for the original order (slip or not)
      if (ma?.originalRef) for (const u of result.uploads || [result.upload]) await markReplacement(u.id, ma.originalRef, ma.note).catch(() => {})
      onLog?.({
        entity_type: 'dispatch', entity_id: result.upload.id, entity_name: job.file.name, action: ma ? `Replacement for ${ma.originalRef}` : 'Labels uploaded',
        detail: `Batch ${result.label || result.upload.code} · ${plan.batches.reduce((s, b) => s + b.labels.length, 0)} labels · saved automatically${held.length ? ` · ${held.length} on hold` : ''}`,
        source: 'dispatch',
      })
      patch(id, { status: 'saved', result, shipDate: job.meta.shipDate || londonDate(), labels: plan.batches.reduce((s, b) => s + b.labels.length, 0), read: null })
      return
    }
    patch(id, { status: 'review', read, existing, history, helmCodes, unitsByCode, codeInfo, needsYou: plan.needsYou, manual, prime, premium })
  } catch (e) {
    patch(id, { status: 'error', error: e?.message || 'Couldn\'t read that file' })
  }
}

// Closing the tab mid-read would lose the file: ask first
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (jobs.some(j => j.status === 'reading' || j.status === 'saving')) { e.preventDefault(); e.returnValue = '' }
  })
}
