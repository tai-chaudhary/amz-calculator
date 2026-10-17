/**
 * Uploads read in the background. Reading a file of picture labels takes a
 * while, so it runs here — outside any screen — and the rest of the portal
 * stays free to use. When it's done, a file with nothing to sort out is saved
 * as a batch straight away; anything else waits for a quick review.
 *
 * Jobs live for as long as the browser tab is open.
 */
import { readDispatchFile, releaseOcr } from './dispatchPdf'
import { pairPages, planUpload, londonDate } from './dispatch'
import { loadDispatchMappings, findExistingOrders, saveDispatchUpload, findCustomerHistory, loadItemUnits } from './db'

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

/** Starts reading a file. meta: { title, me, onLog, shipDate } — who picks it is asked at printing */
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
    const { pages, bytes } = await readDispatchFile(job.file, (progress) => patch(id, { progress }))
    const paired = pairPages(pages)
    const refs = paired.orders.flatMap(o => [o.slip?.channelRef, o.slip?.helmOrder, o.slip?.slipId]).filter(Boolean)
    // Labels with no slip: what's been sent to that address before suggests what this is
    const loosePostcodes = paired.orders.filter(o => !o.slip).map(o => o.labels[0]?.postcode).filter(Boolean)
    const [mappings, existing, history, units] = await Promise.all([
      loadDispatchMappings().catch(() => []),
      findExistingOrders(refs).catch(() => []),
      findCustomerHistory(loosePostcodes).catch(() => []),
      loadItemUnits().catch(() => []),
    ])
    // HELM's product list: any item code not in it means the slip was misread
    const helmCodes = new Set(units.filter(u => u.source === 'helm').map(u => u.code_key))
    const read = { pages, bytes, ...paired }
    const unitsByCode = new Map(units.map(u => [u.code_key, u]))
    const plan = planUpload(paired.orders, mappings, { existing, helmCodes, unitsByCode })

    // Nothing for a person to decide: save it as a batch now
    if (plan.needsYou === 0 && plan.batches.length) {
      patch(id, { status: 'saving', read, existing, history })
      const { me, picker, title, onLog } = job.meta
      const held = plan.heldBack.map(o => ({ ...o, holdReason: 'Held back at upload to check' }))
      const result = await saveDispatchUpload({
        file: job.file, bytes, pageCount: pages.length, batches: plan.batches, held, me, shipDate: job.meta.shipDate || londonDate(), picker, title,
      })
      onLog?.({
        entity_type: 'dispatch', entity_id: result.upload.id, entity_name: job.file.name, action: 'Labels uploaded',
        detail: `Batch ${result.upload.code} · ${plan.batches.reduce((s, b) => s + b.labels.length, 0)} labels · saved automatically`,
        source: 'dispatch',
      })
      patch(id, { status: 'saved', result, shipDate: job.meta.shipDate || londonDate(), labels: plan.batches.reduce((s, b) => s + b.labels.length, 0), read: null })
      return
    }
    patch(id, { status: 'review', read, existing, history, helmCodes, unitsByCode, needsYou: plan.needsYou })
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
