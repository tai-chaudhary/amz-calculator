/**
 * Print Station (Oct 2026): staff print from their phones; the warehouse Mac, with the Zebra on its cable, prints.
 *
 * A print becomes a job — the PDF in the private print-jobs bucket and a row in print_jobs. The Print Station page,
 * open on the Mac in Chrome started with --kiosk-printing, takes waiting jobs and prints them straight to the default
 * printer with no dialog. The station checks in every few seconds; a phone sends only while it's online, and follows
 * the job (Sent → Printing → Printed) — if nothing happens, it offers to print on the phone instead.
 */
import { supabase } from './supabase'
import { printHere } from './dispatchPdf.js'

export const STATION = 'warehouse'
const ONLINE_SECONDS = 20

const ls = { get: (k) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } } }
export const isStation = () => ls.get('gg-print-station') === '1'
export const setIsStation = (on) => ls.set('gg-print-station', on ? '1' : '0')
/** Where this device's prints go: auto (phones → station, computers → here), station, or here. */
export const printTarget = () => ls.get('gg-print-to') || 'auto'
export const setPrintTarget = (v) => ls.set('gg-print-to', v)
const phoneLike = () => (typeof window !== 'undefined') && (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 1024)

export const toast = (msg, type = 'success', action = null) =>
  window.dispatchEvent(new CustomEvent('gg-toast', { detail: { msg, type, action } }))

export async function stationStatus() {
  const { data } = await supabase.from('print_stations').select('*').eq('id', STATION).maybeSingle()
  const online = !!data?.last_seen && Date.now() - Date.parse(data.last_seen) < ONLINE_SECONDS * 1000
  return { online, station: data || null }
}

async function myName() {
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return null
  const { data } = await supabase.from('profiles').select('display_name').eq('id', u.user.id).maybeSingle()
  return data?.display_name || u.user.email || null
}

export async function sendToStation(bytes, title, meta = {}) {
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.pdf`
  const { error: upErr } = await supabase.storage.from('print-jobs').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' })
  if (upErr) throw upErr
  const { kind = null, ...rest } = meta || {}
  const { data, error } = await supabase.from('print_jobs').insert({
    station: STATION, title: String(title || 'Print').slice(0, 120), kind, file_path: path, sent_by: await myName(), meta: rest,
  }).select().single()
  if (error) throw error
  return data
}

/** Follow a job until it's printed (or stopped), telling the person as it goes. Waits as long as it takes. */
function follow(job, bytes, title) {
  const started = Date.now()
  const savePdf = { label: 'Print here', run: () => printHere(bytes, title) }
  let said = ''
  const tick = async () => {
    const { data } = await supabase.from('print_jobs').select('status, error, cancelled_by').eq('id', job.id).maybeSingle()
    const st = data?.status
    if (st === 'printed') return toast(`Printed on the Print Station ✓ — ${title}`, 'info')
    if (st === 'failed') return toast(`The Print Station couldn't print it${data?.error ? ` — ${data.error}` : ''} — it's back to print`, 'error')
    if (st === 'cancelled') return toast(`Cancelled${data?.cancelled_by ? ` by ${data.cancelled_by}` : ''} — ${title} is back to print`, 'error')
    if (st === 'printing' && said !== 'printing') { said = 'printing'; toast(`Printing on the Print Station… — ${title}`, 'info') }
    if (st === 'queued' && said !== 'waiting' && Date.now() - started > 15000) {
      const { online } = await stationStatus().catch(() => ({ online: false }))
      if (!online) { said = 'waiting'; toast('The Print Station is offline — it’ll print as soon as it’s back on', 'error', savePdf) }
    }
    if (Date.now() - started < 30 * 60e3) setTimeout(tick, said === 'waiting' ? 5000 : 1500)
  }
  setTimeout(tick, 1200)
}

/**
 * The one place every print goes through. Phones (or a device set to "Always the Print Station") send to the
 * station — online or not: offline, it waits and prints when the station's back. Computers print themselves.
 * Returns { where: 'here' } or { where: 'station', job }.
 */
export async function routePrint(bytes, title = 'labels', meta = {}) {
  const pref = printTarget()
  if (isStation() || pref === 'here' || (pref === 'auto' && !phoneLike())) { printHere(bytes, title); return { where: 'here' } }
  let online = false
  try { online = (await stationStatus()).online } catch { online = false }
  try {
    const job = await sendToStation(bytes, title, meta)
    toast(online ? `Sent to the Print Station — ${title}` : `The Print Station is offline — ${title} will print as soon as it's back on`,
      online ? 'info' : 'error', { label: 'Print here', run: () => printHere(bytes, title) })
    follow(job, bytes, title)
    return { where: 'station', job }
  } catch (e) {
    toast(`Couldn't send to the Print Station (${e?.message || 'error'}) — nothing was printed`, 'error', { label: 'Print here', run: () => printHere(bytes, title) })
    return { where: 'failed' }
  }
}

/** Cancel a waiting print — only its sender or an admin; the database says why if not. */
export async function cancelJob(id) {
  const { error } = await supabase.rpc('print_job_stop', { p_job: id, p_status: 'cancelled' })
  if (error) throw new Error(error.message)
}
/** May this person cancel this print? (the database checks too) */
export const canCancel = (job, me) => !!me && (me.role === 'admin' || (job?.sent_by_id && job.sent_by_id === me.id))

// ── The station itself ───────────────────────────────────────────────────────
export async function heartbeat(name, who) {
  await supabase.from('print_stations').upsert({ id: STATION, name: name || 'Print Station', last_seen: new Date().toISOString(), signed_in_as: who || null })
}
export async function claimJob() {
  const { data, error } = await supabase.rpc('print_claim', { p_station: STATION })
  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data
}
export async function jobFile(path) {
  const { data, error } = await supabase.storage.from('print-jobs').download(path)
  if (error) throw error
  return new Uint8Array(await data.arrayBuffer())
}
export const setJob = (id, patch) => supabase.from('print_jobs').update(patch).eq('id', id)
export async function recentJobs() {
  const { data } = await supabase.from('print_jobs').select('*').eq('station', STATION).order('created_at', { ascending: false }).limit(40)
  return data || []
}
export const jobDone = (id) => supabase.rpc('print_job_done', { p_job: id })
export const jobFailed = (id, error) => supabase.rpc('print_job_stop', { p_job: id, p_status: 'failed', p_error: error })
export async function requeue(job) {
  const { data, error } = await supabase.from('print_jobs').insert({ station: STATION, title: job.title, kind: job.kind, file_path: job.file_path, sent_by: await myName() }).select().single()
  if (error) throw error
  return data
}
