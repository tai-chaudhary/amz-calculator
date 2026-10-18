import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { PageHeader, Icon, StatusBadge, SearchInput, EmptyState, Modal, Drawer, Tabs, Spinner, WarnBox, InfoBox } from './UI'
import {
  loadDispatchMappings, saveDispatchMapping, deleteDispatchMapping, loadDispatchBatches, loadBatchLabels, loadDayOrders, queueNotification,
  loadHeldLabels, loadDispatchUploads, loadDispatchLabel, downloadDispatchFile, saveDispatchUpload,
  releaseHeldLabels, cancelDispatchLabels, markBatchesPrinted,
  loadBatchStats, loadOpenLabels, dispatchBatch, dispatchLabelIds, searchDispatchLabels, markLabelReprinted, loadDayLabels,
  packBatch, loadDashboardLabels, loadItemUnits, saveItemUnits, loadSubstitutes,
} from '../lib/db'
import {
  itemKey, suggestLabelName, londonDate, decode, planUpload, manualSlip, samePostcode, summariseDispatch, guessUnits, normRef,
  suggestStamp, stampName, missingDetail, helmProductsToUnits, nextWorkingDay, londonTime, resolveMapping, boxStamps,
  stampCountProblem, fixedStamp, unitsPerBox, stampProgress, ORDER_STAGES,
  parseRanges, compressRanges, isDelayed, daysLate, pickTotals, byPrintOrder,
} from '../lib/dispatch'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { buildPrintFile, printPdf, downloadPdf, buildCollectionSheet, pagesAsImages } from '../lib/dispatchPdf'
import { startJob, subscribeJobs, dismissJob, toldJobs } from '../lib/dispatchJobs'
import NewOrdersCard from './NewOrdersCard'
import { PickList, ShortCheck, SubstituteFlow } from './PickList'

// The carriers and services a label can be put down as when it couldn't be read
const CARRIERS = { DHL: ['Next Day'], Evri: ['Next Day', 'Standard'] }

// HELM's product names by item code, for naming new items (filled when Dispatch loads)
let HELM_NAMES = new Map()
let HELM_UNITS = new Map()

const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const nextDay = (d) => addDays(d, 1)

// Who printed last on this computer, offered first next time
let lastPerson = ''

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')
const dayOf = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const plural = (n, word) => `${n} ${word}${n !== 1 ? (/(s|x|ch|sh)$/.test(word) ? 'es' : 's') : ''}`
// A tracking number, marked when HELM has confirmed it (or supplied it)
const Tracking = ({ l }) => (l?.tracking ? (
  <span className="tabular-nums">{l.tracking}{String(l.tracking_source || '').startsWith('helm')
    ? <span className="ml-1 text-gain" title={l.tracking_source === 'helm_verified' ? 'Matches HELM' : l.tracking_source === 'helm_corrected' ? `From HELM — the label read ${l.tracking_read}` : 'From HELM'}>✓ HELM</span> : null}</span>
) : null)
const itemsText = (items = []) => items.map(i => `${i.qty === '*' ? 'Any qty' : i.qty} × ${decode(i.name || i.code)}`).join(', ')

/**
 * Dispatch: one HELM file in (labels and packing slips together), batches out —
 * sorted by what goes in each parcel, each with a cover page and the product
 * stamped on every label, printed one batch at a time or all together.
 */
export default function DispatchPage({ me, focusId, onNavigate, showToast, onLog, onChanged, settings, onUpdateSettings }) {
  const today = londonDate()
  const [tab, setTab] = useState('batches')
  const [date, setDate] = useState(today)
  const [batches, setBatches] = useState([])
  const [mappings, setMappings] = useState([])
  const [held, setHeld] = useState([])
  const [uploads, setUploads] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [openBatch, setOpenBatch] = useState(null)
  const [highlight, setHighlight] = useState(null)
  const [printing, setPrinting] = useState(null)
  const [confirmReprint, setConfirmReprint] = useState(null)
  const [who, setWho] = useState(null)               // { list } or { labels } waiting for a name
  const people = settings?.dispatch?.people?.length ? settings.dispatch.people : ['Ankesh', 'Sagar']
  const [jobs, setJobs] = useState([])
  const [itemUnits, setItemUnits] = useState([])
  const [upcoming, setUpcoming] = useState([])     // batches already uploaded for a later day
  const savedSeen = useRef(new Set())
  const [stats, setStats] = useState(new Map())
  const [open, setOpen] = useState([])
  const [closing, setClosing] = useState(null)       // { groups, mode: 'pack' | 'dispatch' }
  const [dayLabels, setDayLabels] = useState([])     // the day's labels, for the Orders tab
  const cutoff = settings?.dispatch?.cutoff || '18:00'
  const [helmFocus, setHelmFocus] = useState(null)   // a HELM order opened from ⌘K
  const helmNames = useMemo(() => new Map(itemUnits.filter(x => x.name).map(x => [x.code_key, x.name])), [itemUnits])

  const reload = useCallback(async () => {
    try {
      const [b, m, h, u, o] = await Promise.all([
        loadDispatchBatches({ from: date, to: date }), loadDispatchMappings(), loadHeldLabels(), loadDispatchUploads(), loadOpenLabels(),
      ])
      setBatches(b); setMappings(m); setHeld(h); setUploads(u); setOpen(o)
      loadDayOrders(date).then(setDayLabels).catch(() => {})
      loadDispatchBatches({ from: nextDay(londonDate()) }).then(setUpcoming).catch(() => setUpcoming([]))
      // HELM's product list ships with the portal: loaded the first time, refreshed by importing HELM's file
      let iu = await loadItemUnits().catch(() => [])
      if (!iu.some(x => x.source === 'helm')) {
        try {
          const { default: helm } = await import('../data/helmProducts.json')
          iu = await saveItemUnits(helm.units, { name: 'HELM import' })
        } catch { /* stays as it was; importing the file does the same */ }
      }
      setItemUnits(iu)
      HELM_NAMES = new Map(iu.filter(x => x.name).map(x => [x.code_key, x.name]))
      HELM_UNITS = new Map(iu.map(x => [x.code_key, x]))
      setStats(await loadBatchStats(b.map(x => x.id)))
    } catch (e) {
      showToast?.(`Couldn't load dispatch — ${e?.message || 'check your connection'}`, 'error')
    } finally { setLoading(false) }
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload() }, [reload])

  // The Orders tab keeps itself current while it's open: packing and dispatch happen on other phones
  const dayOrders = useMemo(() => stampProgress(dayLabels), [dayLabels])
  useEffect(() => {
    if (tab !== 'orders') return
    loadDayOrders(date).then(setDayLabels).catch(() => {})
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadDayOrders(date).then(setDayLabels).catch(() => {}) }, 30000)
    return () => clearInterval(t)
  }, [tab, date])

  // Files being read in the background; a batch saved on its own shows up straight away
  useEffect(() => subscribeJobs((list) => {
    setJobs(list)
    list.forEach(j => toldJobs.set(j.id, j.status))   // seen here, so no toast needed
    const fresh = list.filter(j => j.status === 'saved' && !savedSeen.current.has(j.id))
    if (fresh.length) { fresh.forEach(j => savedSeen.current.add(j.id)); reload(); onChanged?.() }
  }), [reload]) // eslint-disable-line react-hooks/exhaustive-deps

  // Arriving from ⌘K: open the batch, or the batch a label belongs to
  useEffect(() => {
    if (!focusId) return
    const [kind, id] = String(focusId).split(':')
    ;(async () => {
      if (kind === 'helm') { setHelmFocus(id); return }
      if (kind === 'batch') {
        const all = await loadDispatchBatches({})
        const b = all.find(x => x.id === id)
        if (b) { setTab('batches'); setDate(b.ship_date); setOpenBatch(b) }
      } else if (kind === 'label') {
        const l = await loadDispatchLabel(id)
        if (!l) return
        if (l.status === 'held') { setTab('held'); setHighlight(l.order_key); return }
        if (l.status === 'ready' && open.some(x => x.id === l.id && isDelayed(x.batch.ship_date, { cutoff }))) { setTab('delayed'); setHighlight(l.id); return }
        const all = await loadDispatchBatches({})
        const b = all.find(x => x.id === l.batch_id)
        if (b) { setTab('batches'); setDate(b.ship_date); setHighlight(l.id); setOpenBatch(b) }
      }
    })().catch(() => {})
  }, [focusId])

  const changed = () => { reload(); onChanged?.() }

  // ── Printing ───────────────────────────────────────────────────────────────
  const fileCache = useRef(new Map())
  const fileFor = async (path) => {
    if (!fileCache.current.has(path)) fileCache.current.set(path, await downloadDispatchFile(path))
    return fileCache.current.get(path)
  }

  // Is every product of this batch in the list being printed?
  const wholeBatch = (uploadId, list) => batches.filter(g => g.upload_id === uploadId).every(g => list.some(x => x.id === g.id))

  const doPrint = async (list, { download = false, person = null } = {}) => {
    if (!list.length) return
    setPrinting(list.map(b => b.id))
    try {
      // Batch by batch, each batch's products in the order they're listed
      const ordered = [...list].sort((a, b) =>
        String(a.code).localeCompare(String(b.code), undefined, { numeric: true }) || byPrintOrder(a, b))
      const labels = await loadBatchLabels(ordered.map(b => b.id))
      const sections = []
      const summaries = []
      const seenFile = new Set()
      for (const b of ordered) {
        const mine = labels.filter(l => l.batch_id === b.id && l.status !== 'cancelled')
        if (!mine.length) continue
        // A whole batch printed together starts with its summary and pick list
        if (!seenFile.has(b.upload_id) && wholeBatch(b.upload_id, ordered)) {
          const groups = ordered.filter(g => g.upload_id === b.upload_id)
          const all = labels.filter(l => groups.some(g => g.id === l.batch_id) && l.status !== 'cancelled')
          summaries.push({
            beforeSection: sections.length, code: b.code, picker: person || b.upload?.picker, title: b.upload?.title,
            when: dayOf(b.upload?.ship_date || b.ship_date), labels: all.length,
            orders: new Set(all.map(l => l.order_key)).size,
            groups: groups.map(g => ({ label_name: g.label_name, carrier: g.carrier, service: g.service, count: all.filter(l => l.batch_id === g.id).length })),
            pick: pickTotals(all, new Map(itemUnits.map(u => [u.code_key, u]))),
          })
        }
        seenFile.add(b.upload_id)
        sections.push({ batch: b, labels: mine, fileBytes: await fileFor(b.upload?.storage_path), uploadedBy: (person || b.upload?.picker) ? `Picker: ${person || b.upload.picker}` : '' })
      }
      if (!sections.length) { showToast?.('Nothing left to print in that selection', 'error'); return }
      const bytes = await buildPrintFile(sections, { summaries })
      const codes = [...new Set(ordered.map(b => b.code))]
      const name = list.length === 1 ? `${list[0].code}-${list[0].label_name}` : codes.length === 1 ? `${codes[0]}-${date}` : `dispatch-${date}`
      if (download) downloadPdf(bytes, `${name.replace(/[^\w-]+/g, '-')}.pdf`)
      else printPdf(bytes, name)
      if (!download) {
        await markBatchesPrinted(list, me, person)
        onLog?.({
          entity_type: 'dispatch', entity_id: list.length === 1 ? list[0].id : null,
          entity_name: list.length === 1 ? `${list[0].code} · ${list[0].label_name}` : `Batch ${[...new Set(list.map(b => b.code))].join(', ')}`,
          action: list.some(b => b.printed_at) ? 'Printed again' : 'Printed',
          detail: `${list.reduce((s, b) => s + b.label_count, 0)} labels · ${plural(list.length, 'product')}${person ? ` · printed by ${person}` : ''}`,
          source: 'dispatch',
        })
        changed()
      }
    } catch (e) {
      showToast?.(`Couldn't build the labels — ${e?.message || 'try again'}`, 'error')
    } finally { setPrinting(null) }
  }

  /** One or more labels on their own — no cover page — for reprints. */
  const printLabels = async (labels, person = null) => {
    if (person) lastPerson = person
    const sections = []
    for (const l of labels) {
      sections.push({ batch: l.batch, labels: [l], fileBytes: await fileFor(l.batch?.upload?.storage_path) })
    }
    const bytes = await buildPrintFile(sections, { cover: false })
    printPdf(bytes, labels.length === 1 ? `reprint-${labels[0].batch?.code}-${labels[0].seq}` : 'reprints')
  }

  const exportDay = async () => {
    try {
      const rows = await loadDayLabels(date)
      if (!rows.length) { showToast?.('Nothing to export for that day', 'error'); return }
      exportRowsToCsv(stampedName(`dispatch-${date}`), rows, [
        { header: 'Dispatch Date', value: r => r.batch?.ship_date || '' },
        { header: 'Batch', value: r => r.batch?.code || '' },
        { header: 'Label No', value: r => `${r.seq} of ${r.batch?.label_count || ''}` },
        { header: 'Parcel', value: r => r.label_name || r.batch?.label_name || '' },
        { header: 'Items', value: r => itemsText(r.items) },
        { header: 'Carrier', value: r => r.carrier || r.batch?.carrier || '' },
        { header: 'Service', value: r => r.service || r.batch?.service || '' },
        { header: 'Tracking', value: r => r.tracking || '' },
        { header: 'Order Ref', value: r => r.channel_ref || '' },
        { header: 'HELM Order', value: r => r.helm_order || '' },
        { header: 'Customer', value: r => r.customer || '' },
        { header: 'Postcode', value: r => r.postcode || '' },
        { header: 'Status', value: r => (r.status === 'ready' ? (r.packed_at ? 'Ready for dispatch' : r.printed_at ? 'Printed' : 'To print') : ({ dispatched: 'Dispatched', cancelled: 'Cancelled' }[r.status] || r.status)) },
        { header: 'Printed', value: r => (r.printed_at ? new Date(r.printed_at).toLocaleString('en-GB') : '') },
        { header: 'Printed By', value: r => r.printed_by_name || '' },
        { header: 'Ready For Dispatch', value: r => (r.packed_at ? new Date(r.packed_at).toLocaleString('en-GB') : '') },
        { header: 'Packed By', value: r => r.packed_by_name || '' },
        { header: 'Dispatched', value: r => (r.dispatched_at ? new Date(r.dispatched_at).toLocaleString('en-GB') : '') },
        { header: 'Dispatched By', value: r => r.dispatched_by_name || '' },
        { header: 'Reprints', value: r => r.reprint_count || 0 },
      ])
    } catch (e) { showToast?.(`Couldn't export — ${e?.message || 'try again'}`, 'error') }
  }

  // Printing always asks who it is: the warehouse shares one login, and the
  // person printing is the one who picks, packs and dispatches those labels
  const askPrint = (list) => setWho({ list })
  const printAs = (list, person) => {
    lastPerson = person
    const already = list.filter(b => b.printed_at)
    if (already.length) setConfirmReprint({ list, already, person })
    else doPrint(list, { person })
  }

  // ── What's on screen ───────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [carrier, setCarrier] = useState('')
  const [status, setStatus] = useState('')
  const [picked, setPicked] = useState(new Set())

  const carriers = [...new Set(batches.map(b => `${b.carrier} ${b.service}`.trim()))].sort()
  const shown = batches.filter(b => {
    if (carrier && `${b.carrier} ${b.service}`.trim() !== carrier) return false
    if (status === 'toprint' && b.printed_at) return false
    if (status === 'printed' && !b.printed_at) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!`${b.code} ${b.label_name} ${b.contents} ${b.carrier} ${b.service} ${b.upload?.picker || ''} ${b.upload?.title || ''}`.toLowerCase().includes(q)) return false
    }
    return true
  })
  const toPrint = batches.filter(b => !b.printed_at)
  // A batch is one uploaded file; its products are the groups inside it
  const files = useMemo(() => {
    const m = new Map()
    for (const g of batches) {
      if (!m.has(g.upload_id)) m.set(g.upload_id, { id: g.upload_id, code: g.code, upload: g.upload || {}, groups: [] })
      m.get(g.upload_id).groups.push(g)
    }
    for (const f of m.values()) f.groups.sort(byPrintOrder)
    return [...m.values()].sort((a, b) => String(b.code).localeCompare(String(a.code), undefined, { numeric: true }))
  }, [batches])

  const printed = batches.filter(b => b.printed_at)
  const sumLabels = (list) => list.reduce((s, b) => s + (b.label_count || 0), 0)
  const heldOrders = new Set(held.map(l => `${l.upload_id}|${l.order_key}`)).size
  const delayed = open.filter(l => isDelayed(l.batch.ship_date, { cutoff }))
  const statOf = (b) => stats.get(b.id) || { ready: b.label_count, dispatched: 0, cancelled: 0 }
  const dayDispatched = batches.reduce((s, b) => s + statOf(b).dispatched, 0)
  const closable = batches.filter(b => b.printed_at && statOf(b).ready > 0)
  // Time left to the cut-off, ticking over each minute
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60000); return () => clearInterval(t) }, [])
  const [ch, cm] = cutoff.split(':').map(Number)
  const [nh, nm] = londonTime().split(':').map(Number)
  const minsLeft = ch * 60 + cm - (nh * 60 + nm)
  const stillToGo = batches.reduce((s, b) => s + statOf(b).ready, 0)
  const collectionSheet = async () => {
    try {
      // Bundled by what's stamped on the labels, across every batch of the day
      const byStamp = new Map()
      for (const b of batches) {
        const n = statOf(b).ready + statOf(b).dispatched
        if (!n) continue
        const k = `${b.carrier}|${b.service}|${b.label_name}`
        if (!byStamp.has(k)) byStamp.set(k, { carrier: b.carrier, service: b.service, label_name: b.label_name, count: 0 })
        byStamp.get(k).count += n
      }
      const groups = [...byStamp.values()].sort((a, b) => b.count - a.count || a.label_name.localeCompare(b.label_name))
      if (!groups.length) { showToast?.('Nothing to collect on that day', 'error'); return }
      printPdf(await buildCollectionSheet({ date: dayOf(date), groups, preparedBy: me?.name }), `collection-${date}`)
    } catch (e) { showToast?.(`Couldn't build the sheet — ${e?.message || 'try again'}`, 'error') }
  }
  const packable = (list) => list.filter(b => b.printed_at && statOf(b).ready - statOf(b).packed > 0)
  const ready = batches.reduce((s, b) => s + statOf(b).packed, 0)
  const isToday = date === today
  const shownFiles = files
    .map(f => ({ ...f, groups: f.groups.filter(g => shown.includes(g)) }))
    .filter(f => f.groups.length || (search.trim() && `${f.code} ${f.upload.picker} ${f.upload.title}`.toLowerCase().includes(search.toLowerCase())))
    .map(f => (f.groups.length ? f : { ...f, groups: files.find(x => x.id === f.id).groups }))
  const allShownPicked = shownFiles.length > 0 && shownFiles.every(f => picked.has(f.id))
  const pickedList = batches.filter(b => picked.has(b.upload_id))
  const pickers = [...new Set(uploads.map(u => u.picker).filter(Boolean))]
  const [pickFor, setPickFor] = useState(null)       // { title, subtitle, ids } — the pick list open
  const [subsFor, setSubsFor] = useState(null)       // batch ids — recording a substitute
  // Labels of the day by stage, for the flow at the top
  const flow = batches.reduce((f, b) => {
    const st = statOf(b)
    if (!b.printed_at) f.toPrint += st.ready
    else f.printed += st.ready - st.packed
    f.ready += st.packed
    f.gone += st.dispatched
    f.total += st.ready + st.dispatched
    return f
  }, { toPrint: 0, printed: 0, ready: 0, gone: 0, total: 0 })
  const waitingIds = batches.filter(b => statOf(b).ready > 0).map(b => b.id)
  // The batch belongs to whoever printed it (they pick, pack and send it); before that, whoever it was uploaded for
  const responsibleFor = (f) => {
    const printedBy = f.groups.filter(g => g.printed_at && g.printed_by_name)
      .sort((a, b) => String(b.printed_at).localeCompare(String(a.printed_at)))[0]?.printed_by_name
    return printedBy || f.upload.picker || ''
  }

  return (
    <div>
      <PageHeader
        eyebrow="Warehouse / dispatch"
        title="Dispatch"
        description="From HELM to the van: what's coming in, what to pick, print, pack and send."
        actions={
          <>
            {waitingIds.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => setPickFor({ title: `Pick list · ${isToday ? 'today' : dayOf(date)}`, subtitle: `Everything still to go — ${plural(files.filter(f => f.groups.some(g => statOf(g).ready > 0)).length, 'batch')}`, ids: waitingIds })}>
                <Icon name="list" size={14} /> Pick list
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setUploading(true)}>
              <Icon name="upload" size={14} /> Upload labels
            </button>
            {(batches.length > 0 || closable.length > 0) && (
              <MoreMenu items={[
                closable.length > 0 && { label: `Close ${isToday ? 'today' : 'the day'}`, hint: 'Everything printed goes, except labels left over', icon: 'check', run: () => setClosing({ groups: closable, mode: 'dispatch', dayClose: true }) },
                batches.length > 0 && { label: 'Collection sheet', hint: 'Parcels per carrier, for the driver to sign', icon: 'printer', run: collectionSheet },
                batches.length > 0 && { label: 'Export day', hint: 'Every label, who printed and dispatched it', icon: 'download', run: exportDay },
              ].filter(Boolean)} />
            )}
          </>
        }
      />

      {/* The day: which one, how long to the cut-off, and anything that needs a look */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex items-center bg-white border border-rule rounded-[6px]">
          <button className="icon-btn" aria-label="Day before" onClick={() => { setDate(addDays(date, -1)); setPicked(new Set()) }}><Icon name="chevronLeft" size={16} /></button>
          <label className="relative px-1 text-sm font-semibold text-ink cursor-pointer tabular-nums">
            {isToday ? `Today · ${dayOf(date)}` : dayOf(date)}
            <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" value={date} aria-label="Dispatch date"
              onChange={e => { setDate(e.target.value || today); setPicked(new Set()) }} />
          </label>
          <button className="icon-btn" aria-label="Next day" onClick={() => { setDate(addDays(date, 1)); setPicked(new Set()) }}><Icon name="chevronRight" size={16} /></button>
        </div>
        {!isToday && <button className="btn btn-ghost btn-sm" onClick={() => setDate(today)}>Back to today</button>}
        {isToday && stillToGo > 0 && (
          <span className={`pill ${minsLeft <= 0 ? 'pill-alert' : minsLeft <= 60 ? 'pill-alert' : 'pill-brand'}`}>
            <Icon name="clock" size={12} />
            {minsLeft > 0 ? `${minsLeft >= 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `${minsLeft}m`} to the ${cutoff} cut-off` : `Past the ${cutoff} cut-off`}
            {' · '}{plural(stillToGo, 'label')} to go
          </span>
        )}
        {delayed.length > 0 && <button className="pill pill-alert" onClick={() => setTab('delayed')}><Icon name="alert" size={12} /> {delayed.length} delayed</button>}
        {heldOrders > 0 && <button className="pill pill-alert" onClick={() => setTab('held')}><Icon name="alert" size={12} /> {heldOrders} on hold</button>}
        {isToday && upcoming.length > 0 && [...new Set(upcoming.map(b => b.ship_date))].sort().map(d => (
          <button key={d} className="pill pill-quiet" onClick={() => setDate(d)} title="Already uploaded — not on today's list">
            {dayOf(d)}: {plural(upcoming.filter(b => b.ship_date === d).reduce((s, b) => s + b.label_count, 0), 'label')}
          </button>
        ))}
      </div>

      <FlowBar stages={[
        { id: 'toprint', label: 'To print', value: flow.toPrint, color: 'bg-ink/20', dot: 'bg-ink/30', onClick: flow.toPrint ? () => { setTab('batches'); setStatus(s => (s === 'toprint' ? '' : 'toprint')) } : null, active: status === 'toprint' },
        { id: 'printed', label: 'Picking & packing', value: flow.printed, color: 'bg-royal-300', dot: 'bg-royal-300', onClick: flow.printed ? () => { setTab('batches'); setStatus(s => (s === 'printed' ? '' : 'printed')) } : null, active: status === 'printed' },
        { id: 'ready', label: 'Ready for dispatch', value: flow.ready, color: 'bg-royal-500', dot: 'bg-royal-500', onClick: closable.length ? () => setClosing({ groups: closable, mode: 'dispatch', dayClose: true }) : null, hint: flow.ready ? 'tap to dispatch' : null },
        { id: 'gone', label: 'Dispatched', value: flow.gone, color: 'bg-lime', dot: 'bg-gain' },
      ]} total={flow.total} />

      {jobs.length > 0 && (
        <div className="space-y-2 mb-4">
          {jobs.map(j => <JobCard key={j.id} job={j} onReview={() => setUploading(j)} onShow={() => { setDate(j.shipDate || today); setTab('batches'); dismissJob(j.id) }} />)}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
      <div className="min-w-0 xl:order-1 order-2">
      <Tabs value={tab} onChange={setTab} items={[
        { id: 'batches', label: 'Batches', count: files.length },
        { id: 'orders', label: 'Orders', count: dayOrders.totals.orders || null },
        { id: 'delayed', label: 'Delayed', count: delayed.length || null },
        { id: 'find', label: 'Find & reprint' },
        { id: 'held', label: 'On hold', count: heldOrders || null },
        { id: 'mappings', label: 'Parcel mappings', count: mappings.length },
        { id: 'uploads', label: 'Uploads' },
      ]} />

      {loading ? <Spinner /> : (
        <>
          {tab === 'batches' && (
            <>
              {files.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Batch, product, person…" className="flex-1 min-w-[180px]" />
                  {carriers.length > 1 && (
                    <select className="input text-sm w-auto" value={carrier} onChange={e => setCarrier(e.target.value)} aria-label="Carrier">
                      <option value="">All carriers</option>
                      {carriers.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                  {status && (
                    <button className="filter-chip" onClick={() => setStatus('')}>
                      {status === 'toprint' ? 'To print' : 'Printed'} <Icon name="close" size={12} />
                    </button>
                  )}
                </div>
              )}
              {!isToday && date > today && (
                <div className="surface-sky px-4 py-3 mb-3 text-sm text-royal-800">
                  These are for <b>{dayOf(date)}</b> — not today's list. They can be printed and packed early; they only count as late after {dayOf(date)}'s {cutoff} cut-off.
                </div>
              )}
              {(toPrint.length > 0 || picked.size > 0) && (
                <div className="surface-sky px-4 py-3 mb-3 flex items-center justify-between gap-3 flex-wrap">
                  {picked.size > 0 ? (
                    <>
                      <div className="text-sm text-ink">
                        <b>{plural(picked.size, 'batch')}</b> selected · {plural(sumLabels(pickedList), 'label')}
                        <button className="link-chip ml-2" onClick={() => setPicked(new Set())}>Clear</button>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-secondary btn-sm" disabled={!!printing} onClick={() => doPrint(pickedList, { download: true })}><Icon name="download" size={14} /> Download</button>
                        <button className="btn btn-primary btn-sm" disabled={!!printing} onClick={() => askPrint(pickedList)}><Icon name="printer" size={14} /> Print selected</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm text-ink">
                        <b>{plural(sumLabels(toPrint), 'label')}</b> to print across {plural(new Set(toPrint.map(b => b.upload_id)).size, 'batch')}
                        <span className="hidden sm:inline text-ink/55"> — each batch starts with its pick list</span>
                      </div>
                      <button className="btn btn-primary btn-sm" disabled={!!printing} onClick={() => askPrint(toPrint)}>
                        <Icon name="printer" size={14} /> {printing && printing.length > 1 ? 'Building…' : 'Print all'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {files.length === 0 ? (
                <div className="surface">
                  <EmptyState icon="printer" title={isToday ? 'No labels uploaded today' : `No batches on ${dayOf(date)}`}
                    sub="Upload a HELM file — one pick list, its labels and packing slips together. It becomes one batch, split by product, with every label stamped."
                    action={<button className="btn btn-primary btn-sm" onClick={() => setUploading(true)}><Icon name="upload" size={14} /> Upload labels</button>} />
                </div>
              ) : (
                <div className="space-y-3">
                  {shownFiles.length > 1 && (
                    <label className="hidden sm:flex items-center gap-2 text-xs text-ink/50 px-1 cursor-pointer w-fit">
                      <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={allShownPicked}
                        onChange={() => setPicked(allShownPicked ? new Set() : new Set(shownFiles.map(f => f.id)))} />
                      Select all batches
                    </label>
                  )}
                  {shownFiles.map(f => (
                    <BatchCard key={f.id} file={f} statOf={statOf} picked={picked.has(f.id)} printing={printing}
                      onPick={() => setPicked(s => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })}
                      onPrintBatch={() => askPrint(f.groups)} onPrintGroup={(g) => askPrint([g])} onOpenGroup={setOpenBatch}
                      onDispatch={(list) => setClosing({ groups: list || f.groups.filter(g => g.printed_at && statOf(g).ready > 0), mode: 'dispatch' })}
                      onPack={(list) => setClosing({ groups: packable(list || f.groups), mode: 'pack' })}
                      onPickList={() => setPickFor({ title: `Pick list · Batch ${f.code}`, subtitle: [responsibleFor(f) && `${responsibleFor(f)}'s batch`, f.upload.title, dayOf(f.upload.ship_date || date)].filter(Boolean).join(' · '), ids: f.groups.map(g => g.id) })}
                      onSubstitute={() => setSubsFor(f.groups.map(g => g.id))}
                      responsible={responsibleFor(f)} />
                  ))}
                  {shownFiles.length === 0 && <div className="surface px-4 py-10 text-center text-sm text-ink/45">Nothing matches those filters.</div>}
                </div>
              )}
            </>
          )}

          {tab === 'orders' && (
            <DayOrders summary={dayOrders} dayLabel={isToday ? 'today' : dayOf(date)} />
          )}
          {tab === 'delayed' && (
            <DelayedList labels={delayed} cutoff={cutoff} me={me} highlight={highlight} showToast={showToast} onLog={onLog}
              onChanged={changed} onReprint={async (labels) => setWho({ labels })}
              canEditCutoff={me?.role === 'admin' && !!onUpdateSettings}
              onCutoff={(v) => onUpdateSettings({ ...settings, dispatch: { ...(settings?.dispatch || {}), cutoff: v } })} />
          )}

          {tab === 'find' && (
            <FindReprint me={me} cutoff={cutoff} showToast={showToast} onLog={onLog} onChanged={changed} onReprint={printLabels} people={people} />
          )}

          {tab === 'held' && (
            <HeldList held={held} mappings={mappings} highlight={highlight} me={me}
              onChanged={changed} showToast={showToast} onLog={onLog} onMappingsChanged={setMappings} />
          )}

          {tab === 'mappings' && (
            <MappingsList mappings={mappings} me={me} showToast={showToast} onChanged={changed} itemUnits={itemUnits} />
          )}

          {tab === 'uploads' && (
            <UploadsList uploads={uploads} onOpenDay={(d) => { setDate(d); setTab('batches') }} />
          )}
        </>
      )}
      </div>

      {/* What's still coming from HELM: beside the work on a wide screen, above it on a phone */}
      <div className="min-w-0 order-1 xl:order-2 xl:sticky xl:top-6">
        <NewOrdersCard me={me} mappings={mappings} names={helmNames} focus={helmFocus} showToast={showToast} onLog={onLog} />
      </div>
      </div>

      {uploading && (
        <UploadFlow me={me} job={typeof uploading === 'object' ? uploading : null} mappings={mappings} pickers={pickers} cutoff={cutoff}
          onMappingsChanged={setMappings} showToast={showToast} onLog={onLog}
          onClose={() => setUploading(false)}
          onSaved={(result) => {
            const day = result.upload?.ship_date || today
            setUploading(false); setDate(day); setTab('batches'); setStatus(''); changed()
            showToast?.(day !== today
              ? `Batch ${result.upload.code} saved for ${dayOf(day)} — not on today's dispatch list`
              : `Batch ${result.upload.code} ready to print · ${plural(result.batches.length, 'product')}${result.held ? ` · ${result.held} on hold` : ''}`)
          }} />
      )}

      {openBatch && (
        <BatchDrawer batch={batches.find(b => b.id === openBatch.id) || openBatch} highlight={highlight} printing={printing}
          onClose={() => { setOpenBatch(null); setHighlight(null) }}
          onPrint={(b) => askPrint([b])} onDownload={(b) => doPrint([b], { download: true })}
          stat={statOf(batches.find(b => b.id === openBatch.id) || openBatch)}
          onDispatch={(b) => setClosing({ groups: [b], mode: 'dispatch' })}
          onPack={(b) => setClosing({ groups: [b], mode: 'pack' })}
          onSubstitute={(b) => setSubsFor([b.id])}
          onPickList={(b) => setPickFor({ title: `Pick list · ${b.code} · ${b.label_name}`, subtitle: b.printed_by_name ? `${b.printed_by_name}'s batch` : '', ids: [b.id] })} />
      )}

      {pickFor && (
        <PickList title={pickFor.title} subtitle={pickFor.subtitle} batchIds={pickFor.ids} people={people} me={me} showToast={showToast}
          onClose={() => setPickFor(null)} />
      )}
      {subsFor && (
        <SubstituteFlow batchIds={subsFor} people={people} me={me} showToast={showToast} onClose={() => setSubsFor(null)} onDone={changed} />
      )}

      {closing && (
        <CloseDay batches={closing.groups} mode={closing.mode} stats={stats} me={me} people={people} single={closing.groups.length === 1} dayClose={!!closing.dayClose}
          dayLabel={isToday ? 'today' : dayOf(date)} showToast={showToast} onLog={onLog}
          onClose={() => setClosing(null)} onDone={() => { setClosing(null); changed() }} />
      )}

      {who && (
        <WhoPrinting people={people} title={who.labels ? `Printing ${plural(who.labels.length, 'label')} again` : `Printing ${who.list.length === 1 ? `${who.list[0].code} · ${who.list[0].label_name}` : `${plural(new Set(who.list.map(b => b.upload_id)).size, 'batch')} · ${plural(who.list.reduce((s, b) => s + b.label_count, 0), 'label')}`}`}
          canAdd={me?.role === 'admin' && !!onUpdateSettings}
          onAdd={(name) => onUpdateSettings({ ...settings, dispatch: { ...(settings?.dispatch || {}), people: [...people, name] } })}
          onClose={() => setWho(null)}
          onPick={async (person) => {
            const w = who; setWho(null)
            if (w.list) printAs(w.list, person)
            else {
              try {
                await printLabels(w.labels, person)
                for (const l of w.labels) await markLabelReprinted(l, 'Printed again from Delayed', me, person)
                changed()
              } catch (e) { showToast?.(e?.message || 'Couldn\'t print', 'error') }
            }
          }} />
      )}

      {confirmReprint && (
        <Modal title={confirmReprint.list.length === 1 ? `${confirmReprint.list[0].code} has already been printed` : 'Some of these have already been printed'}
          onClose={() => setConfirmReprint(null)}>
          <div className="text-sm text-ink/70 space-y-1.5">
            {confirmReprint.already.slice(0, 6).map(b => (
              <div key={b.id}><b>{b.code}</b> {b.label_name} — printed by {b.printed_by_name || 'someone'} at {timeOf(b.printed_at)}</div>
            ))}
            {confirmReprint.already.length > 6 && <div>…and {confirmReprint.already.length - 6} more</div>}
            <p className="pt-2 text-ink/55">Printing again makes a second set of the same labels. Only do this if the first set was lost or damaged.</p>
          </div>
          <div className="flex gap-2 pt-4">
            {confirmReprint.list.length > confirmReprint.already.length && (
              <button className="btn btn-secondary flex-1" onClick={() => {
                const rest = confirmReprint.list.filter(b => !b.printed_at); const pp = confirmReprint.person; setConfirmReprint(null); doPrint(rest, { person: pp })
              }}>Only the new ones</button>
            )}
            <button className="btn btn-primary flex-1" onClick={() => { const l = confirmReprint.list; const pp = confirmReprint.person; setConfirmReprint(null); doPrint(l, { person: pp }) }}>
              Print {confirmReprint.list.length > confirmReprint.already.length ? 'all' : 'again'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Metric({ label, value, sub, tone = '', onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`metric-card text-left px-3 py-2.5 sm:px-4 sm:py-3.5 ${onClick ? 'hover:border-royal-300 transition-colors' : ''}`} onClick={onClick}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value text-lg sm:text-xl ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] sm:text-xs text-ink/45 mt-0.5 leading-snug">{sub}</div>}
    </Tag>
  )
}

// ── One batch ────────────────────────────────────────────────────────────────

function BatchDrawer({ batch, highlight, printing, stat, onClose, onPrint, onDownload, onDispatch, onPack, onSubstitute, onPickList }) {
  const [labels, setLabels] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => { loadBatchLabels(batch.id).then(setLabels).catch(() => setLabels([])) }, [batch.id, batch.printed_at])
  const busy = printing?.includes(batch.id)
  const shown = (labels || []).filter(l => !q.trim() ||
    `${l.seq} ${l.customer} ${l.postcode} ${l.channel_ref} ${l.helm_order} ${l.tracking}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <Drawer title={`${batch.code} · ${batch.label_name}`} width="max-w-2xl"
      description={`${dayOf(batch.ship_date)} · ${batch.carrier} ${batch.service} · ${plural(batch.label_count, 'label')} from ${plural(batch.order_count, 'order')}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-ink/50">
            {batch.printed_at ? `Printed by ${batch.printed_by_name || 'someone'} at ${timeOf(batch.printed_at)}${batch.print_count > 1 ? ` · printed ${batch.print_count} times` : ''}` : 'Not printed yet'}
            {stat?.packed > 0 && <div>{stat.packed} of {batch.label_count} ready for dispatch</div>}
            {stat?.dispatched > 0 && <div>{stat.dispatched} of {batch.label_count} dispatched</div>}
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {stat?.ready > 0 && onPickList && (
              <button className="btn btn-secondary btn-sm" onClick={() => onPickList(batch)}><Icon name="list" size={14} /> Pick list</button>
            )}
            {onSubstitute && (
              <button className="btn btn-secondary btn-sm" onClick={() => onSubstitute(batch)} title="Something else went instead — before or after dispatch">
                <Icon name="swap" size={14} /> Substitute
              </button>
            )}
            {batch.printed_at && stat && stat.ready - stat.packed > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => onPack(batch)}><Icon name="layers" size={14} /> Ready for dispatch</button>
            )}
            {batch.printed_at && stat?.ready > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => onDispatch(batch)}><Icon name="check" size={14} /> Mark dispatched</button>
            )}
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onDownload(batch)}><Icon name="download" size={14} /> Download</button>
            <button className={`btn btn-sm ${batch.printed_at ? 'btn-secondary' : 'btn-primary'}`} disabled={busy} onClick={() => onPrint(batch)}>
              <Icon name="printer" size={14} /> {busy ? 'Building…' : batch.printed_at ? 'Print again' : 'Print batch'}
            </button>
          </div>
        </div>
      }>
      {batch.contents && batch.contents.toUpperCase() !== batch.label_name.toUpperCase() && (
        <div className="text-sm text-ink/70 mb-4">Each parcel: <b className="text-ink">{batch.contents}</b></div>
      )}
      <div className="text-xs text-ink/50 mb-3">
        Each label is stamped <b className="text-ink/70">{batch.label_name.toUpperCase()} 1/{batch.label_count} · {batch.code}</b> and the batch prints with a cover page first.
      </div>
      {labels === null ? <Spinner /> : (
        <>
          {labels.length > 8 && <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Customer, postcode, order ref…" className="mb-3" />}
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule bg-paper">
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-ink/45 w-12">No.</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink/45">Customer</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink/45">Order</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink/45">Tracking</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink/45">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(l => (
                  <tr key={l.id} className={`border-b border-rule last:border-0 ${highlight === l.id ? 'bg-sky/45' : ''}`}>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{l.seq}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-ink">{l.customer || '—'}</div>
                      <div className="text-xs text-ink/45">{l.postcode}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="text-ink/70 tabular-nums">{l.channel_ref || l.helm_order || '—'}</div>
                      <div className="text-ink/40">{itemsText(l.items)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink/55">{l.tracking ? <Tracking l={l} /> : '—'}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap"><LabelStatus label={l} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Drawer>
  )
}

// ── Upload: read, check, set up anything new, create the batches ─────────────

/**
 * Uploading is two separate moments. First: drop the file in, say who's
 * picking it, and walk away — it's read in the background. Then, only if
 * something needs a person, the review: set up new items, fix what's held.
 */
function UploadFlow({ me, job = null, mappings, pickers = [], cutoff = '18:00', onMappingsChanged, showToast, onLog, onClose, onSaved }) {
  const inputRef = useRef(null)
  const [stage, setStage] = useState(job ? 'review' : 'pick')   // pick, review, saving
  const file = job?.file || null
  const read = job?.read || null
  const existing = job?.existing || []
  const [overrides, setOverrides] = useState({})    // order id → true (include) / false (hold)
  const [carrierFix, setCarrierFix] = useState({})  // order index → { carrier, service } for labels it couldn't read
  const [manual, setManual] = useState({})          // order index → { mapping, qty, reason, note, originalRef } for labels with no slip
  const history = job?.history || []
  const [title, setTitle] = useState(job?.meta?.title || '')
  // Which day's dispatch these go out on: after the cut-off, the next working day
  const today = londonDate()
  const afterCutoff = londonTime() >= cutoff
  const [shipDate, setShipDate] = useState(job?.meta?.shipDate || (afterCutoff ? nextWorkingDay(today) : today))
  const notToday = shipDate !== today
  const [error, setError] = useState('')

  const take = (files) => {
    const f = [...(files || [])].find(x => /\.pdf$/i.test(x.name) || x.type === 'application/pdf')
    if (!f) { setError('Choose the PDF from HELM'); return }
    // The file's own name usually says which pick list it is
    const name = title.trim() || f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 60)
    startJob(f, { title: name, me, onLog, shipDate })
    showToast?.(notToday
      ? `Reading the labels for ${dayOf(shipDate)} — they won't be on today's dispatch list`
      : 'Reading the labels — carry on with anything else, it\'ll let you know when it\'s done')
    onClose()
  }

  const { checked, batches, heldBack, included } = useMemo(
    () => (read ? planUpload(read.orders, mappings, { existing, overrides, carrierFix, manual, helmCodes: job?.helmCodes || null, unitsByCode: job?.unitsByCode || null }) : { checked: [], batches: [], heldBack: [], included: () => false }),
    [read, mappings, existing, overrides, carrierFix, manual],
  )
  const toMap = useMemo(() => {
    const m = new Map()
    for (const o of checked) if (o.level === 'map' && !m.has(o.key)) m.set(o.key, { key: o.key, items: o.slip.items, orders: [] })
    for (const o of checked) if (o.level === 'map') m.get(o.key).orders.push(o)
    return [...m.values()]
  }, [checked])
  const holds = checked.filter(o => o.level === 'hold')
  const unsaid = checked.filter(o => o.level === 'manual').length
  const checks = checked.filter(o => o.level === 'check')
  const labelTotal = checked.reduce((s, o) => s + o.labels.length, 0)

  const save = async () => {
    setStage('saving'); setError('')
    try {
      const heldList = heldBack.map(o => ({
        ...o, holdReason: o.level === 'manual' ? 'No packing slip — say what this parcel is'
          : o.level === 'map' ? 'New item — not set up yet'
          : o.level === 'check' ? 'Held back at upload to check' : undefined,
      }))
      const result = await saveDispatchUpload({ file, bytes: read.bytes, pageCount: read.pages.length, batches, held: heldList, me, shipDate, title: title.trim() })
      if (job) dismissJob(job.id)
      onLog?.({
        entity_type: 'dispatch', entity_id: result.upload.id, entity_name: file.name, action: 'Labels uploaded',
        detail: `${plural(batches.length, 'batch')} · ${plural(batches.reduce((s, b) => s + b.labels.length, 0), 'label')}${heldList.length ? ` · ${heldList.length} on hold` : ''}`,
        source: 'dispatch',
      })
      onSaved({ ...result, held: heldList.length })
    } catch (e) {
      setError(`Couldn't save — ${e?.message || 'try again'}. Nothing was saved.`); setStage('review')
    }
  }

  const footer = stage === 'review' || stage === 'saving' ? (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-xs text-ink/55">
        One batch · {plural(batches.reduce((s, b) => s + b.labels.length, 0), 'label')} in {plural(batches.length, 'product')}
        {heldBack.length > 0 && <span className="text-loss"> · {plural(heldBack.length, 'order')} on hold</span>}
      </div>
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={stage === 'saving'}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={stage === 'saving' || (!batches.length && !heldBack.length)} onClick={save}>
          {stage === 'saving' ? 'Saving…' : batches.length ? `Create batch · ${plural(batches.reduce((s, b) => s + b.labels.length, 0), 'label')}` : 'Save to On hold'}
        </button>
      </div>
    </div>
  ) : null

  return (
    <Drawer title="Upload labels" width="max-w-3xl" onClose={stage === 'saving' ? undefined : onClose} footer={footer}
      description={file ? `${file.name}${read ? ` · ${plural(read.pages.length, 'page')}` : ''}` : 'The HELM file with labels and packing slips together — read in the background'}>
      {stage === 'pick' && (
        <>
          <div className="mb-4">
            <label className="label" htmlFor="dp-title0">Pick list name <span className="text-ink/40 font-normal">— optional</span></label>
            <input id="dp-title0" className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Taken from the file name if left empty" />
            <div className="text-xs text-ink/45 mt-1">Who picks it is asked when the batch is printed.</div>
          </div>
          <div className="mb-4">
            <label className="label">Dispatch day</label>
            <div className="flex items-center gap-2 flex-wrap">
              <button className={`btn btn-sm ${shipDate === today ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShipDate(today)}>Today</button>
              <button className={`btn btn-sm ${shipDate === nextWorkingDay(today) ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShipDate(nextWorkingDay(today))}>
                {dayOf(nextWorkingDay(today))}
              </button>
              <input type="date" className="input text-sm w-[150px]" value={shipDate} min={today} onChange={e => setShipDate(e.target.value || today)} aria-label="Dispatch day" />
            </div>
            {notToday ? (
              <div className="text-xs text-loss mt-1.5">
                {afterCutoff && shipDate === nextWorkingDay(today) ? `Today's ${cutoff} cut-off has passed, so these ` : 'These '}
                go on <b>{dayOf(shipDate)}</b>'s dispatch list — <b>not today's</b>.
              </div>
            ) : afterCutoff ? (
              <div className="text-xs text-loss mt-1.5">It's past today's {cutoff} cut-off — they'll show as delayed straight away. Choose {dayOf(nextWorkingDay(today))} if today's collection has gone.</div>
            ) : null}
          </div>
          <div role="button" tabIndex={0} aria-label="Choose the labels file"
            className="border-2 border-dashed border-rule rounded-card py-14 text-center cursor-pointer hover:border-royal-300 transition-colors"
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); take(e.dataTransfer.files) }}>
            <Icon name="upload" size={24} className="text-royal-400 mx-auto" />
            <div className="text-sm font-medium text-ink mt-2">Drop the HELM labels file here</div>
            <div className="text-xs text-ink/50 mt-1">All of today's orders in one PDF — labels and packing slips together</div>
            <input ref={inputRef} type="file" className="hidden" accept=".pdf,application/pdf" onChange={e => { take(e.target.files); e.target.value = '' }} />
          </div>
          {error && <WarnBox title="That didn't work">{error}</WarnBox>}
          <InfoBox title="What happens next">
            The file is read in the background — you can close this and carry on. If every order checks out, it's saved as a
            batch on its own and you'll see it appear. If anything needs you (a new item, a label that doesn't match), it waits
            here for a quick look. Keep this browser tab open until it's done.
          </InfoBox>
        </>
      )}

      {(stage === 'review' || stage === 'saving') && read && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Orders" value={checked.length} />
            <Metric label="Labels" value={labelTotal} sub={read.skipped ? `${read.skipped} other page${read.skipped !== 1 ? 's' : ''} left out` : undefined} />
            <Metric label="Products" value={batches.length} />
            <Metric label="Need you" value={toMap.length + holds.length + unsaid} tone={toMap.length + holds.length + unsaid ? 'text-loss' : 'text-gain'}
              sub={toMap.length + holds.length + unsaid ? 'see below' : 'all checked'} />
          </div>

          {error && <WarnBox title="Not saved">{error}</WarnBox>}

          {notToday && (
            <div className="text-sm text-loss">These go on <b>{dayOf(shipDate)}</b>'s dispatch list — not today's.</div>
          )}

          <section>
            <label className="label" htmlFor="dp-title">Pick list name <span className="text-ink/40 font-normal">— optional</span></label>
            <input id="dp-title" className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="As it's called in HELM" />
          </section>

          {read.orders.some(o => !o.slip) && (
            <section>
              <SectionTitle title={`Labels without a packing slip — ${plural(read.orders.filter(o => !o.slip).length, 'label')}`}
                sub="Made by hand, so there's no slip to say what's in them. Pick the product — or the order it's replacing, where the portal has found one for that address." />
              <ManualLabels orders={read.orders} mappings={mappings} history={history} manual={manual}
                onChange={(id, v) => setManual(m => ({ ...m, [id]: v }))}
                onAll={(v) => setManual(m => {
                  const n = { ...m }
                  read.orders.forEach((o, i) => { if (!o.slip && !n[`o${i}`]?.mapping) n[`o${i}`] = v })
                  return n
                })} />
            </section>
          )}

          {toMap.length > 0 && (
            <section>
              <SectionTitle title={`New item${toMap.length !== 1 ? 's' : ''} — set up once`}
                sub="Say what goes in each parcel and how many labels an order should have. It's remembered for every upload after this." />
              <div className="space-y-2">
                {toMap.map(g => (
                  <NewMapping key={g.key} group={g} me={me} showToast={showToast}
                    onSaved={(m) => onMappingsChanged([...mappings.filter(x => x.item_key !== m.item_key), m])} />
                ))}
              </div>
            </section>
          )}

          {holds.length > 0 && (
            <section>
              <SectionTitle title={`On hold — ${plural(holds.length, 'order')}`}
                sub="These would risk the wrong parcel going out. Fix what's asked, or tick one once you've checked it — anything left unticked goes to On hold, where you can fix it later." />
              <OrderRows orders={holds} bytes={read.bytes} included={included} onToggle={(o, v) => setOverrides(s => ({ ...s, [o.id]: v }))} tone="alert"
                onCarrier={(o, fix) => setCarrierFix(s => ({ ...s, [o.id]: { ...(s[o.id] || {}), ...fix } }))} carrierFix={carrierFix} />
            </section>
          )}

          {checks.length > 0 && (
            <section>
              <SectionTitle title={`Couldn't be fully checked — ${plural(checks.length, 'order')}`}
                sub="The label couldn't be matched to its slip for certain (no reference, or the postcode couldn't be read). Look at each one and tick it to add it — anything unticked goes to On hold." />
              <OrderRows orders={checks} bytes={read.bytes} included={included} onToggle={(o, v) => setOverrides(s => ({ ...s, [o.id]: v }))} />
              <button className="link-chip mt-2" onClick={() => setOverrides(s => ({ ...s, ...Object.fromEntries(checks.filter(o => o.mapping).map(o => [o.id, true])) }))}>
                I've checked them all — tick all
              </button>
            </section>
          )}

          <section>
            <SectionTitle title="In this batch" sub="One batch number for the whole file. It prints with the pick list first, then each product with its cover page and labels numbered 1, 2, 3…" />
            {batches.length === 0 ? (
              <div className="text-sm text-ink/50">Nothing ready to batch yet{toMap.length ? ' — set up the new items above' : ''}.</div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {batches.map(b => (
                      <tr key={b.key} className="border-b border-rule last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-ink">{b.label_name}</div>
                          {b.contents.toUpperCase() !== b.label_name.toUpperCase() && <div className="text-xs text-ink/45">{b.contents}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-ink/65 whitespace-nowrap">{b.carrier} <span className="text-ink/45">{b.service}</span></td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                          <b>{b.labels.length}</b> <span className="text-xs text-ink/45">label{b.labels.length !== 1 ? 's' : ''} · {plural(b.orders.length, 'order')}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}

function SectionTitle({ title, sub }) {
  return (
    <div className="mb-2.5">
      <div className="text-sm font-semibold text-ink">{title}</div>
      {sub && <div className="text-xs text-ink/50 mt-0.5 leading-relaxed">{sub}</div>}
    </div>
  )
}

function OrderRows({ orders, included, onToggle, tone, collapsed = false, onCarrier, carrierFix = {}, bytes = null }) {
  const [viewing, setViewing] = useState(null)
  const [open, setOpen] = useState(!collapsed)
  if (!open) {
    return <button className="link-chip" onClick={() => setOpen(true)}>Show {plural(orders.length, 'order')}</button>
  }
  return (
    <div className={`card p-0 overflow-hidden ${tone === 'alert' ? 'border-l-2 border-l-coral' : ''}`}>
      {orders.map(o => (
        <label key={o.id} className="flex items-start gap-3 px-4 py-3 border-b border-rule last:border-0 cursor-pointer hover:bg-sky/15">
          <input type="checkbox" className="w-4 h-4 mt-0.5 accent-royal-500" checked={included(o)} disabled={!o.mapping || o.problems.some(p => p.perBox)}
            onChange={e => onToggle(o, e.target.checked)} />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-ink">
              {o.slip?.customer || 'Unknown customer'}{o.slip?.postcode ? <span className="text-ink/45"> · {o.slip.postcode}</span> : null}
              <span className="text-xs text-ink/40"> · {o.slip?.channelRef || o.slip?.helmOrder || `page ${(o.labels[0]?.pageIndex ?? 0) + 1}`}</span>
            </div>
            <div className="text-xs text-ink/50">{itemsText(o.slip?.items) || 'No items read'} · {plural(o.labels.length, 'label')}</div>
            {o.problems.filter(p => p.level !== 'map').map(p => (
              <div key={p.code + p.text} className={`text-xs mt-0.5 ${p.level === 'hold' ? 'text-loss' : 'text-ink/55'}`}>{p.text}</div>
            ))}
            {onCarrier && (o.problems.some(p => p.code === 'carrier') || carrierFix[o.id]) && (
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5" onClick={e => e.preventDefault()}>
                <span className="text-xs text-ink/60">It's</span>
                {Object.keys(CARRIERS).map(c => (
                  <button key={c} className={`btn btn-xs ${carrierFix[o.id]?.carrier === c ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => onCarrier(o, { carrier: c, service: CARRIERS[c].length === 1 ? CARRIERS[c][0] : carrierFix[o.id]?.service })}>{c}</button>
                ))}
                {carrierFix[o.id]?.carrier && CARRIERS[carrierFix[o.id].carrier].length > 1 && CARRIERS[carrierFix[o.id].carrier].map(sv => (
                  <button key={sv} className={`btn btn-xs ${carrierFix[o.id]?.service === sv ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => onCarrier(o, { service: sv })}>{sv}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-ink/45 whitespace-nowrap">{included(o) ? 'Print' : 'Hold'}</span>
            {bytes && <button className="link-chip text-xs" onClick={e => { e.preventDefault(); setViewing(o) }}>View</button>}
          </div>
        </label>
      ))}
      {viewing && (
        <CompareOrder onClose={() => setViewing(null)} loadBytes={async () => bytes}
          labelPages={viewing.labels.map(l => l.pageIndex)} slipPage={viewing.slip?.pageIndex}
          slip={{ customer: viewing.slip?.customer, postcode: viewing.slip?.postcode, ref: viewing.slip?.channelRef || viewing.slip?.helmOrder, items: viewing.slip?.items }}
          stamps={viewing.labels.map(l => l.stampName).filter(Boolean)} problems={viewing.problems} />
      )}
    </div>
  )
}

/** Setting up a new item: the slip's own words are the starting point, so most of the time it's one click. */
function NewMapping({ group, me, showToast, onSaved }) {
  const counts = group.orders.map(o => o.labels.length).filter(Boolean)
  const common = counts.sort((a, b) => counts.filter(x => x === b).length - counts.filter(x => x === a).length)[0] || 1
  // HELM's own name for each item, shortened only as far as needed — never losing the size or the variety
  const suggested = suggestStamp(group.items, { names: HELM_NAMES }) || suggestLabelName(group.items)
  const fullNames = group.items.map(i => `${i.qty} × ${HELM_NAMES.get(normRef(i.code)) || decode(i.name || i.code)}`).join(' + ')
  const [labelName, setLabelName] = useState(suggested)
  const [contents, setContents] = useState(fullNames)
  const [parcels, setParcels] = useState(String(common))
  const codes = [...new Set(group.items.map(i => i.code.toUpperCase().replace(/[^A-Z0-9]/g, '')))]
  // One product, one label per unit (heavy bags): set it up once for any quantity
  const units = group.items.reduce((s, i) => s + (parseInt(i.qty, 10) || 0), 0)
  const [anyQty, setAnyQty] = useState(codes.length === 1 && units > 1 && units % common === 0)
  // Heavy items: as many as fit under the 25kg box limit (10kg → 2, 12.5kg → 2, 15kg+ → 1)
  const [perBox, setPerBox] = useState(String(unitsPerBox({ ...group.items[0], name: HELM_NAMES.get(normRef(group.items[0]?.code)) || group.items[0]?.name }) || Math.max(1, Math.round(units / (common || 1)))))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!labelName.trim()) return
    setBusy(true)
    try {
      const m = await saveDispatchMapping({
        item_key: anyQty ? `${codes[0]}x*` : group.key,
        items: anyQty ? [{ code: group.items[0].code, qty: '*', name: group.items[0].name }] : group.items.map(i => ({ code: i.code, qty: i.qty, name: i.name })),
        label_name: labelName.trim().toUpperCase().slice(0, 60), contents: contents.trim() || labelName.trim(),
        parcels: anyQty ? Math.max(1, parseInt(perBox, 10) || 1) : Math.max(1, parseInt(parcels, 10) || 1), updated_by_name: me?.name || null,
      })
      onSaved(m)
    } catch (e) {
      showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error'); setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="text-sm text-ink font-medium">{itemsText(group.items)}</div>
      <div className="text-xs text-ink/45 mb-3">{group.items.map(i => i.code).join(' + ')} · {plural(group.orders.length, 'order')} in this file</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_1.4fr_110px_auto] gap-2.5 items-end">
        <div>
          <label className="label">{(parseInt(parcels, 10) || 1) > 1 && !anyQty ? 'Stamped on each box' : 'Stamped on the label'}</label>
          <input className="input" value={labelName} maxLength={60} onChange={e => setLabelName(e.target.value)} />
          {(() => {
            const p = stampCountProblem({ item_key: group.key, items: group.items, label_name: labelName, parcels: Math.max(1, parseInt(parcels, 10) || 1) }, new Map([...HELM_UNITS]))
            return p && !anyQty ? <div className="text-xs text-loss mt-1">{p.text} — say what's in each box, e.g. "{p.perBox === 1 ? '' : `${p.perBox} X `}{stampName(HELM_NAMES.get(normRef(group.items[0]?.code)) || '')}"</div> : null
          })()}
          {missingDetail(labelName, suggested).length > 0 && (
            <div className="text-xs text-loss mt-1">Missing {missingDetail(labelName, suggested).join(', ')} — <button className="link-chip" onClick={() => setLabelName(suggested)}>use {suggested}</button></div>
          )}
        </div>
        <div>
          <label className="label">Each parcel holds</label>
          <input className="input" value={contents} onChange={e => setContents(e.target.value)} placeholder="e.g. 1 × 25kg bag" />
        </div>
        {anyQty ? (
          <div>
            <label className="label">Units per box</label>
            <input className="input" type="number" min="1" value={perBox} onChange={e => setPerBox(e.target.value)} />
          </div>
        ) : (
          <div>
            <label className="label">Labels per order</label>
            <input className="input" type="number" min="1" value={parcels} onChange={e => setParcels(e.target.value)} />
          </div>
        )}
        <button className="btn btn-primary btn-sm h-[38px]" disabled={busy || !labelName.trim()} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {codes.length === 1 && (
        <label className="flex items-center gap-2 mt-2.5 text-xs text-ink/65 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={anyQty} onChange={e => setAnyQty(e.target.checked)} />
          Any quantity — set up once for every order of this item, however many are ordered (e.g. 1 bag a box: 6 bags = 6 labels)
        </label>
      )}
      {!anyQty && counts.length > 0 && new Set(counts).size > 1 && (
        <div className="text-xs text-loss mt-2">These orders came with different numbers of labels ({[...new Set(counts)].join(', ')}) — the ones that don't match will be held.</div>
      )}
    </div>
  )
}

// ── On hold ──────────────────────────────────────────────────────────────────

/**
 * On hold: every order the portal kept back, with what's wrong and the fix
 * right there — pick the carrier it couldn't read, set up a new item, or
 * confirm you've checked it — then it goes back into its own batch.
 */
function HeldList({ held, mappings, highlight, me, onChanged, showToast, onLog, onMappingsChanged }) {
  const [picked, setPicked] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [fixes, setFixes] = useState({})          // order key → { carrier, service, checked }
  const [viewing, setViewing] = useState(null)

  const orders = useMemo(() => {
    const m = new Map()
    for (const l of held) {
      const k = `${l.upload_id}|${l.order_key}`
      if (!m.has(k)) m.set(k, { key: k, uploadId: l.upload_id, labels: [], first: l })
      m.get(k).labels.push(l)
    }
    const byKey = new Map(mappings.map(x => [x.item_key, x]))
    return [...m.values()].map(o => {
      const real = o.labels.filter(l => !l.stamp?.noLabel)
      const fix = fixes[o.key] || {}
      const noSlip = !(o.first.items || []).length
      // A hand-made label with no slip: the person says what it is
      const resolved = noSlip ? { mapping: fix.manual?.mapping || null, anyQty: String(fix.manual?.mapping?.item_key || '').endsWith('x*') } : resolveMapping(o.first.items || [], real.length, byKey)
      const mapping = resolved.mapping
      const anyQty = resolved.anyQty
      const units = (o.first.items || []).reduce((t, i) => t + (parseInt(i.qty, 10) || 0), 0)
      // An any-quantity order whose labels don't add up: the person says what's in each box
      const perBoxNeeded = !noSlip && anyQty && /can't tell what's in each box/.test(String(o.first.hold_reason || ''))
      const boxes = fix.boxes || (mapping && anyQty ? boxStamps(mapping, o.first.items || [], real.length, { anyQty }).map(t => parseInt(t, 10) || 1) : [])
      const boxesOk = !perBoxNeeded || (boxes.length === real.length && boxes.every(n => n > 0) && boxes.reduce((t, n) => t + n, 0) === units)
      const needsCarrier = real.some(l => !l.carrier)
      const reason = String(o.first.hold_reason || '')
      // Reasons that only a person can clear: wrong reference, postcode, count, already uploaded
      const needsCheck = /match|postcode|should have|already uploaded|different carriers|label says|isn't in helm|couldn't be/i.test(reason) && !/can't tell what's in each box/.test(reason)
      const steps = {
        label: real.length > 0,
        mapping: !!mapping,
        carrier: !needsCarrier || (fix.carrier && fix.service),
        checked: !needsCheck || !!fix.checked,
      }
      steps.boxes = boxesOk
      return { ...o, real, mapping, anyQty, units, perBoxNeeded, boxes, fix, noSlip, needsCarrier, needsCheck, steps, releasable: Object.values(steps).every(Boolean) }
    })
  }, [held, mappings, fixes])

  if (!orders.length) {
    return <div className="surface"><EmptyState icon="check" title="Nothing on hold" sub="Orders the portal couldn't check safely wait here until someone has looked at them." /></div>
  }

  const setFix = (key, patch) => setFixes(f => ({ ...f, [key]: { ...(f[key] || {}), ...patch } }))
  const chosen = orders.filter(o => picked.has(o.key))
  const ready = orders.filter(o => o.releasable)

  const release = async (list) => {
    if (!list.length) return
    setBusy(true)
    try {
      const groups = new Map()
      for (const o of list) {
        const told = o.noSlip && o.fix.manual ? manualSlip(o.first, o.fix.manual) : null
        const items = told ? told.items : (o.first.items || [])
        // What's stamped on each box: from the person's counts, or worked out the same way as at upload
        const base = String(o.mapping.label_name).replace(/^\s*\d+\s*[X×]\s*/i, '').trim()
        const names = o.anyQty && o.perBoxNeeded
          ? o.boxes.map(n => (n === 1 ? `1 X ${base}` : `${n} X ${base}`))
          : boxStamps(o.mapping, items, o.real.length, { anyQty: o.anyQty, manual: !!told })
        const labels = o.real.map((l, k) => ({
          ...(l.carrier ? l : { ...l, carrier: o.fix.carrier, service: o.fix.service }),
          stampName: names[k] || o.mapping.label_name,
          ...(told ? { newItems: told.items, reason: told.reason || 'replacement', note: told.note || null, original_ref: told.originalRef || null } : {}),
        }))
        for (const l of labels) {
          const k = `${o.uploadId}|${l.carrier}|${l.service}|${l.stampName}`
          if (!groups.has(k)) groups.set(k, { uploadId: o.uploadId, code: o.first.upload?.code || 'B?', carrier: l.carrier, service: l.service, label_name: l.stampName, contents: o.mapping.contents, labels: [], orders: new Set() })
          const g = groups.get(k)
          g.labels.push(l); g.orders.add(o.key)
        }
      }
      const saved = await releaseHeldLabels([...groups.values()].map(g => ({
        ...g, orderCount: g.orders.size, labels: g.labels.sort((a, b) => a.page_index - b.page_index),
      })), londonDate())
      const codes = [...new Set(saved.map(b => b.code))].join(', ')
      onLog?.({ entity_type: 'dispatch', entity_name: `${plural(list.length, 'order')} fixed`, action: 'Released from hold',
        detail: `Back into ${codes}: ${list.map(o => `${o.first.customer || o.first.order_key}${o.fix.checked ? ' (checked by hand)' : ''}${o.fix.carrier ? ` (set to ${o.fix.carrier} ${o.fix.service})` : ''}`).join(', ')}`, source: 'dispatch' })
      showToast?.(`Back in ${codes} — ready to print`)
      setPicked(new Set()); onChanged()
    } catch (e) { showToast?.(`Couldn't add them back — ${e?.message || 'try again'}`, 'error') }
    finally { setBusy(false) }
  }

  const cancel = async () => {
    setBusy(true)
    try {
      await cancelDispatchLabels(chosen.flatMap(o => o.labels.map(l => l.id)), `Cancelled by ${me?.name || 'someone'}`)
      onLog?.({ entity_type: 'dispatch', entity_name: `${plural(chosen.length, 'order')} cancelled`, action: 'Cancelled', source: 'dispatch' })
      setPicked(new Set()); setCancelling(false); onChanged()
    } catch (e) { showToast?.(`Couldn't cancel — ${e?.message || 'try again'}`, 'error') }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="text-xs text-ink/55">Fix what's listed under each order, then add it back to its own batch — it prints with that batch's number.</div>
        {ready.length > 0 && picked.size === 0 && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => release(ready)}>
            <Icon name="check" size={14} /> Add all fixed ({ready.length}) back to their batches
          </button>
        )}
      </div>
      {picked.size > 0 && (
        <div className="card mb-4 border-royal-200 bg-royal-50 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-ink">
            <b>{picked.size}</b> selected
            {chosen.some(o => !o.releasable) && <span className="text-ink/55"> · {chosen.filter(o => !o.releasable).length} still need fixing</span>}
            <button className="link-chip ml-2" onClick={() => setPicked(new Set())}>Clear selection</button>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setCancelling(true)}>Cancel orders</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !chosen.some(o => o.releasable)} onClick={() => release(chosen.filter(o => o.releasable))}>
              <Icon name="check" size={14} /> {busy ? 'Working…' : `Add ${plural(chosen.filter(o => o.releasable).length, 'order')} back`}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {orders.map(o => {
          const code = o.first.upload?.code
          return (
            <div key={o.key} className={`card ${highlight === o.first.order_key ? 'ring-2 ring-sky' : ''} ${o.releasable ? '' : 'border-l-2 border-l-coral'}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" className="w-4 h-4 mt-1 accent-royal-500 cursor-pointer" checked={picked.has(o.key)}
                  aria-label={`Select ${o.first.customer || 'order'}`}
                  onChange={() => setPicked(s => { const n = new Set(s); n.has(o.key) ? n.delete(o.key) : n.add(o.key); return n })} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">
                    {o.first.customer || 'Unknown customer'}{o.first.postcode && <span className="text-ink/45"> · {o.first.postcode}</span>}
                    <span className="text-xs text-ink/40"> · {o.first.channel_ref || o.first.helm_order || 'no reference'}</span>
                  </div>
                  <div className="text-xs text-ink/50">
                    {itemsText(o.first.items) || 'No items read'} · {plural(o.real.length, 'label')} · <b className="text-ink/65">{code || '—'}</b> · {o.first.upload?.file_name} · page {(o.real[0]?.page_index ?? o.first.page_index) + 1}
                  </div>
                  <div className="text-xs text-loss mt-1">{o.first.hold_reason}</div>

                  {/* The fixes, one line each */}
                  <div className="mt-2.5 space-y-2">
                    {!o.steps.label && (
                      <div className="text-xs text-ink/60">There's no label for this order in the file — generate it again in HELM and upload it, or cancel this one.</div>
                    )}
                    {o.needsCarrier && (
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className={o.steps.carrier ? 'text-gain' : 'text-ink/65'}>{o.steps.carrier ? '✓' : '1.'} Which carrier is the label?</span>
                        {Object.keys(CARRIERS).map(c => (
                          <button key={c} className={`btn btn-xs ${o.fix.carrier === c ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setFix(o.key, { carrier: c, service: CARRIERS[c].length === 1 ? CARRIERS[c][0] : o.fix.service })}>{c}</button>
                        ))}
                        {o.fix.carrier && CARRIERS[o.fix.carrier].length > 1 && CARRIERS[o.fix.carrier].map(sv => (
                          <button key={sv} className={`btn btn-xs ${o.fix.service === sv ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setFix(o.key, { service: sv })}>{sv}</button>
                        ))}
                      </div>
                    )}
                    {o.noSlip && (
                      <div className="text-xs">
                        <span className={o.mapping ? 'text-gain' : 'text-ink/65'}>{o.mapping ? '✓' : ''} No packing slip — what is this parcel?</span>
                        <div className="mt-1.5"><ProductPicker value={o.fix.manual} mappings={mappings} onChange={(v) => setFix(o.key, { manual: v })} /></div>
                      </div>
                    )}
                    {!o.mapping && o.first.items?.length > 0 && (
                      <div className="text-xs">
                        <span className="text-ink/65">Set up this item — what's stamped on the label and what goes in each parcel:</span>
                        <HeldMapping order={o} me={me} showToast={showToast} onSaved={(m) => onMappingsChanged([...mappings.filter(x => x.item_key !== m.item_key), m])} />
                      </div>
                    )}
                    {o.perBoxNeeded && o.mapping && (
                      <div className="text-xs">
                        <span className={o.steps.boxes ? 'text-gain' : 'text-ink/65'}>{o.steps.boxes ? '✓ ' : ''}What's in each box? {o.units} in total across {plural(o.real.length, 'label')}</span>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {o.real.map((l, k) => (
                            <label key={l.id} className="flex items-center gap-1 text-ink/55">
                              Box {k + 1}
                              <input className="input text-xs w-[56px] py-1" type="number" min="1" value={o.boxes[k] ?? ''}
                                onChange={e => setFix(o.key, { boxes: o.real.map((_, j) => (j === k ? parseInt(e.target.value, 10) || 0 : (o.boxes[j] || 0))) })} />
                            </label>
                          ))}
                          {!o.steps.boxes && <span className="text-loss">must add up to {o.units}</span>}
                        </div>
                      </div>
                    )}
                    {o.needsCheck && (
                      <label className="flex items-center gap-2 text-xs text-ink/70 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={!!o.fix.checked} onChange={e => setFix(o.key, { checked: e.target.checked })} />
                        I've checked the label against the packing slip — it's the right one
                      </label>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge tone={o.releasable ? 'live' : 'alert'}>{o.releasable ? 'Fixed' : 'Needs fixing'}</StatusBadge>
                  {o.first.upload?.storage_path && <button className="link-chip text-xs" onClick={() => setViewing(o)}>View label &amp; slip</button>}
                  {o.releasable && (
                    <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => release([o])}>Add to {code || 'its batch'}</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {viewing && (
        <CompareOrder onClose={() => setViewing(null)} loadBytes={() => downloadDispatchFile(viewing.first.upload.storage_path)}
          labelPages={viewing.real.map(l => l.page_index)} slipPage={viewing.first.slip_page}
          slip={{ customer: viewing.first.customer, postcode: viewing.first.postcode, ref: viewing.first.channel_ref || viewing.first.helm_order, items: viewing.first.items }}
          problems={[{ level: 'hold', text: viewing.first.hold_reason }]} />
      )}

      {cancelling && (
        <Modal title={`Cancel ${plural(chosen.length, 'order')}?`} onClose={() => setCancelling(false)}>
          <p className="text-sm text-ink/65">They'll leave On hold and won't be printed. Cancel the label in HELM too, so you're not charged for it.</p>
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1" onClick={() => setCancelling(false)}>Keep them</button>
            <button className="btn btn-danger flex-1" disabled={busy} onClick={cancel}>Cancel orders</button>
          </div>
        </Modal>
      )}
    </>
  )
}

function HeldMapping({ order, me, showToast, onSaved }) {
  return (
    <div className="mt-1.5">
      <NewMapping group={{ key: itemKey(order.first.items), items: order.first.items, orders: [{ labels: order.real }] }}
        me={me} showToast={showToast} onSaved={onSaved} />
    </div>
  )
}

// ── Mappings ─────────────────────────────────────────────────────────────────

function MappingsList({ mappings, me, showToast, onChanged, itemUnits = [] }) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [importing, setImporting] = useState(false)
  const [fixing, setFixing] = useState(false)
  const fileRef = useRef(null)
  const names = useMemo(() => new Map(itemUnits.filter(u => u.name).map(u => [u.code_key, u.name])), [itemUnits])
  const helmCount = itemUnits.filter(u => u.source === 'helm').length
  const unitsMap = useMemo(() => new Map(itemUnits.map(u => [u.code_key, u])), [itemUnits])
  // Stamps that say the wrong number for what's in each box — these are held until fixed
  const wrongCount = mappings.map(m => ({ m, p: stampCountProblem(m, unitsMap) })).filter(x => x.p)
    .map(x => ({ ...x, fixed: fixedStamp(x.m, unitsMap, x.p) }))
  const lastImport = itemUnits.filter(u => u.source === 'helm').map(u => u.updated_at).sort().pop()

  // Names that have lost the detail that tells products apart (size, weight, variety)
  const short = mappings
    .filter(m => !String(m.item_key).endsWith('x*') || true)
    .map(m => {
      const items = String(m.item_key).endsWith('x*') ? (m.items || []).map(i => ({ ...i, qty: 1 })) : (m.items || [])
      const suggested = suggestStamp(items, { names })
      return { m, suggested, missing: suggested ? missingDetail(m.label_name, suggested) : [] }
    })
    .filter(x => x.missing.length)

  const importHelm = async (file) => {
    if (!file) return
    setImporting(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const units = helmProductsToUnits(rows)
      if (!units.length) throw new Error('no products found — is it HELM\'s Inventory Products and Groups export?')
      await saveItemUnits(units, me)
      showToast?.(`${plural(units.length, 'HELM product')} imported — ${units.filter(u => u.components.length > 1 || u.units > 1).length} bundles`)
      onChanged()
    } catch (e) { showToast?.(`Couldn't import — ${e?.message || 'try again'}`, 'error') }
    finally { setImporting(false) }
  }

  const fixAll = async () => {
    setFixing(true)
    try {
      for (const x of short) await saveDispatchMapping({ ...x.m, label_name: x.suggested, updated_by_name: me?.name || null })
      showToast?.(`${plural(short.length, 'name')} fixed`)
      onChanged()
    } catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error') }
    finally { setFixing(false) }
  }

  const helmBar = (
    <div className="card mb-4 flex items-center justify-between gap-3 flex-wrap">
      <div className="text-sm text-ink">
        <b>HELM products</b>
        <span className="text-ink/55"> · {helmCount ? `${helmCount} codes${lastImport ? `, updated ${dayOf(lastImport)}` : ''}` : 'not loaded yet'} — used for exact units, bundle contents and label names</span>
      </div>
      <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={e => { importHelm(e.target.files?.[0]); e.target.value = '' }} />
      <button className="btn btn-secondary btn-sm" disabled={importing} onClick={() => fileRef.current?.click()}>
        <Icon name="upload" size={14} /> {importing ? 'Importing…' : 'Import HELM products'}
      </button>
    </div>
  )
  const shown = mappings.filter(m => !q.trim() ||
    `${m.label_name} ${m.contents} ${(m.items || []).map(i => `${i.code} ${i.name}`).join(' ')}`.toLowerCase().includes(q.toLowerCase()))

  if (!mappings.length) {
    return <>{helmBar}<div className="surface"><EmptyState icon="layers" title="No parcel mappings yet" sub="The first time an item turns up in an upload, you'll be asked what goes in each parcel. It's remembered from then on." /></div></>
  }
  return (
    <>
      {helmBar}
      {wrongCount.length > 0 && (
        <div className="card mb-4 border-l-2 border-l-coral">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-ink"><b>{plural(wrongCount.length, 'stamp')}</b> say{wrongCount.length === 1 ? 's' : ''} the wrong number for what's in each box
              <span className="text-ink/55"> — orders using {wrongCount.length === 1 ? 'it are' : 'them are'} held until it's fixed.</span></div>
            <button className="btn btn-primary btn-sm" disabled={fixing} onClick={async () => {
              setFixing(true)
              try { for (const x of wrongCount) await saveDispatchMapping({ ...x.m, label_name: x.fixed, updated_by_name: me?.name || null }); onChanged() }
              catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error') }
              finally { setFixing(false) }
            }}>{fixing ? 'Fixing…' : 'Fix all'}</button>
          </div>
          <div className="mt-2.5 space-y-1">
            {wrongCount.map(x => (
              <div key={x.m.id} className="text-xs text-ink/65">
                <span className="text-ink/45 line-through">{x.m.label_name}</span> → <b className="text-ink">{x.fixed}</b>
                <span className="text-loss"> ({x.p.text}{x.m.parcels > 1 ? `, ${x.m.parcels} boxes an order` : ''})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {short.length > 0 && (
        <div className="card mb-4 border-l-2 border-l-coral">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-ink"><b>{plural(short.length, 'label name')}</b> missing a size, weight or variety
              <span className="text-ink/55"> — so two products could look the same on the stamp.</span></div>
            <button className="btn btn-primary btn-sm" disabled={fixing} onClick={fixAll}>{fixing ? 'Fixing…' : 'Fix all'}</button>
          </div>
          <div className="mt-2.5 space-y-1">
            {short.map(x => (
              <div key={x.m.id} className="text-xs text-ink/65">
                <span className="text-ink/45 line-through">{x.m.label_name}</span> → <b className="text-ink">{x.suggested}</b>
                <span className="text-loss"> (adds {x.missing.join(', ')})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="filter-bar mb-4">
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Name, item code…" className="flex-1 min-w-[200px]" />
        <div className="text-xs text-ink/45 sm:ml-auto">{shown.length} of {mappings.length}</div>
      </div>
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule bg-paper">
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink/45">Stamped on the label</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-ink/45">Each parcel holds</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-ink/45">On the packing slip</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Labels / order</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map(m => (
                <tr key={m.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{m.label_name}</td>
                  <td className="px-3 py-3 text-ink/70">{m.contents}</td>
                  <td className="px-3 py-3 text-xs">
                    <div className="text-ink/70">{itemsText(m.items)}</div>
                    <div className="text-ink/40">{(m.items || []).map(i => i.code).join(' + ')}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{m.item_key.endsWith('x*') ? <span title="Any quantity">{m.parcels} a box</span> : m.parcels}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="icon-btn" aria-label="Edit" title="Edit" onClick={() => setEditing(m)}><Icon name="edit" size={15} /></button>
                    <button className="icon-btn" aria-label="Delete" title="Delete" onClick={() => setDeleting(m)}><Icon name="trash" size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <EditMapping mapping={editing} me={me} showToast={showToast} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged() }} />}
      {deleting && (
        <Modal title={`Delete "${deleting.label_name}"?`} onClose={() => setDeleting(null)}>
          <p className="text-sm text-ink/65">Labels already printed keep their stamp. The next upload with this item will ask you to set it up again.</p>
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1" onClick={() => setDeleting(null)}>Keep it</button>
            <button className="btn btn-danger flex-1" onClick={async () => {
              try { await deleteDispatchMapping(deleting.id); setDeleting(null); onChanged() }
              catch (e) { showToast?.(`Couldn't delete — ${e?.message || 'try again'}`, 'error') }
            }}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  )
}

function EditMapping({ mapping, me, showToast, onClose, onSaved }) {
  const [labelName, setLabelName] = useState(mapping.label_name)
  const [contents, setContents] = useState(mapping.contents || '')
  const [parcels, setParcels] = useState(String(mapping.parcels))
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Edit parcel mapping" description={itemsText(mapping.items)} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Stamped on the label</label>
          <input className="input" value={labelName} maxLength={40} onChange={e => setLabelName(e.target.value)} />
          <div className="text-xs text-ink/45 mt-1">Keep it short — it's printed small. Batches already created keep their name.</div></div>
        <div><label className="label">Each parcel holds</label>
          <input className="input" value={contents} onChange={e => setContents(e.target.value)} /></div>
        <div><label className="label">{mapping.item_key.endsWith('x*') ? 'Units per box (any quantity)' : 'Labels per order'}</label>
          <input className="input" type="number" min="1" value={parcels} onChange={e => setParcels(e.target.value)} /></div>
        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1" disabled={busy || !labelName.trim()} onClick={async () => {
            setBusy(true)
            try {
              await saveDispatchMapping({ ...mapping, label_name: labelName.trim().toUpperCase(), contents: contents.trim() || labelName.trim(),
                parcels: Math.max(1, parseInt(parcels, 10) || 1), updated_by_name: me?.name || null })
              onSaved()
            } catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
          }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Uploads ──────────────────────────────────────────────────────────────────

function UploadsList({ uploads, onOpenDay }) {
  if (!uploads.length) return <div className="surface"><EmptyState icon="upload" title="Nothing uploaded yet" /></div>
  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-rule bg-paper">
            <th className="text-left px-4 py-3 text-xs font-semibold text-ink/45">When</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-ink/45">Batch</th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Orders</th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Labels</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-ink/45">On hold</th>
          </tr>
        </thead>
        <tbody>
          {uploads.map(u => (
            <tr key={u.id} className="border-b border-rule last:border-0 hover:bg-sky/20 cursor-pointer" onClick={() => onOpenDay(londonDate(new Date(u.created_at)))}>
              <td className="px-4 py-3 whitespace-nowrap">
                <div className="text-ink">{dayOf(londonDate(new Date(u.created_at)))} · {timeOf(u.created_at)}</div>
                <div className="text-xs text-ink/45">{u.uploaded_by_name || '—'}</div>
              </td>
              <td className="px-3 py-3 max-w-[300px]">
                <div className="text-ink truncate"><b className="tabular-nums">{u.code || '—'}</b>{u.picker ? ` · ${u.picker}` : ''}</div>
                <div className="text-xs text-ink/45 truncate">{u.title || u.file_name}</div>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{u.orders}</td>
              <td className="px-3 py-3 text-right tabular-nums">{u.labels}</td>
              <td className={`px-4 py-3 text-right tabular-nums ${u.held ? 'text-loss' : 'text-ink/40'}`}>{u.held || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Status ───────────────────────────────────────────────────────────────────

function BatchStatus({ batch, stat }) {
  const total = batch.label_count
  if (stat.dispatched > 0 && stat.ready === 0) {
    return <StatusBadge tone="live" dot>Dispatched</StatusBadge>
  }
  if (stat.dispatched > 0) {
    return <div><StatusBadge tone="alert" dot>Part dispatched</StatusBadge><div className="text-xs text-ink/45 mt-1">{stat.dispatched} of {total} gone</div></div>
  }
  if (stat.packed > 0 && stat.packed === stat.ready) {
    return <StatusBadge tone="live">Ready for dispatch</StatusBadge>
  }
  if (stat.packed > 0) {
    return <div><StatusBadge tone="brand" dot>Part ready</StatusBadge><div className="text-xs text-ink/45 mt-1">{stat.packed} of {total} packed</div></div>
  }
  if (batch.printed_at) {
    return <div><StatusBadge tone="brand" dot>Printed</StatusBadge><div className="text-xs text-ink/45 mt-1">{batch.printed_by_name || 'someone'} · {timeOf(batch.printed_at)}{batch.print_count > 1 ? ` · ${batch.print_count}×` : ''}</div></div>
  }
  return <StatusBadge tone="quiet" dot>To print</StatusBadge>
}

function LabelStatus({ label }) {
  if (label.status === 'dispatched') return <span className="text-ink/60">Dispatched {timeOf(label.dispatched_at)}{label.dispatched_by_name ? ` · ${label.dispatched_by_name}` : ''}</span>
  if (label.status === 'cancelled') return <span className="text-ink/40">Cancelled</span>
  if (label.status === 'held') return <span className="text-loss">On hold</span>
  if (label.packed_at) return <span className="text-royal-600">Ready {timeOf(label.packed_at)}{label.packed_by_name ? ` · ${label.packed_by_name}` : ''}</span>
  return <span className={label.printed_at ? 'text-royal-600' : 'text-ink/45'}>{label.printed_at ? 'Printed, not packed' : 'Not printed'}</span>
}

// ── Close day: everything printed goes, except the labels left over ──────────

/**
 * The warehouse knows what didn't go because the labels are still in their
 * hands — each stamped with its number. So they type those numbers and the
 * rest are marked dispatched in one go.
 */
function CloseDay({ batches, mode = 'dispatch', stats, me, people = [], single, dayClose = false, dayLabel, showToast, onLog, onClose, onDone }) {
  const pack = mode === 'pack'
  const [left, setLeft] = useState({})            // batch id → "10-25, 31"
  const [busy, setBusy] = useState(false)
  const [answered, setAnswered] = useState(false) // every short product said what went
  const parsed = batches.map(b => {
    const r = parseRanges(left[b.id], b.label_count)
    const st = stats.get(b.id) || { ready: b.label_count, packed: 0, dispatched: 0 }
    return { b, ...r, ready: pack ? st.ready - st.packed : st.ready, packed: st.packed }
  })
  const errors = parsed.filter(p => p.errors.length)
  const goingNow = parsed.reduce((s, p) => s + Math.max(0, p.ready - p.set.size), 0)
  const leftOver = parsed.reduce((s, p) => s + p.set.size, 0)

  const confirm = async () => {
    setBusy(true)
    try {
      let done = 0
      for (const p of parsed) done += pack ? await packBatch(p.b.id, [...p.set], me) : await dispatchBatch(p.b.id, [...p.set], me)
      const codes = [...new Set(batches.map(b => b.code))].join(', ')
      onLog?.({
        entity_type: 'dispatch', entity_name: single ? `${batches[0].code} · ${batches[0].label_name}` : pack ? `Batch ${codes}` : `Closed ${dayLabel}`,
        action: pack ? (leftOver ? 'Part ready for dispatch' : 'Ready for dispatch') : (leftOver ? 'Part dispatched' : 'Dispatched'),
        detail: `${plural(done, 'label')} ${pack ? 'ready' : 'dispatched'}${leftOver ? ` · left over: ${parsed.filter(p => p.set.size).map(p => `${p.b.code} ${compressRanges([...p.set])}`).join('; ')}` : ''}`,
        source: 'dispatch',
      })
      showToast?.(`${plural(done, 'label')} ${pack ? 'ready for dispatch' : 'dispatched'}${leftOver ? ` · ${leftOver} left for later` : ''}`)
      // Closing the whole day posts the day's summary to ClickUp
      if (!pack && dayClose && batches[0]?.ship_date) queueNotification('day_closed', { date: batches[0].ship_date, by: me?.name || null, labels: done, left_over: leftOver })
      onDone()
    } catch (e) { showToast?.(`Couldn't mark them — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
  }

  return (
    <Modal maxWidth="max-w-xl" onClose={onClose}
      title={pack
        ? (single ? `${batches[0].code} · ${batches[0].label_name} ready for dispatch` : `Batch ${[...new Set(batches.map(b => b.code))].join(', ')} ready for dispatch`)
        : (single ? `Dispatch ${batches[0].code} · ${batches[0].label_name}` : `Close ${dayLabel}`)}
      description={pack
        ? 'Packed and labelled, waiting for collection — everything printed, except any labels not packed yet.'
        : 'Everything printed is marked dispatched, except any labels left over.'}>
      <ShortCheck batchIds={batches.map(b => b.id)} people={people} me={me} showToast={showToast} onReady={setAnswered} />
      <div className="text-xs text-ink/55 mb-3">
        {pack ? 'Any not packed yet? ' : 'Got labels left over? '}Type the numbers stamped on them — e.g. <b>10-25, 31</b>. Leave it empty if {pack ? "they're all packed" : 'everything went'}.
      </div>
      <div className="card p-0 overflow-hidden mb-4">
        {parsed.map(p => (
          <div key={p.b.id} className="flex items-center gap-3 px-4 py-3 border-b border-rule last:border-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink"><b className="tabular-nums">{p.b.code}</b> {p.b.label_name}</div>
              <div className="text-xs text-ink/45">
                {p.b.carrier} {p.b.service} · {plural(p.ready, 'label')} {pack ? 'to pack' : 'waiting'}{p.ready < p.b.label_count ? ` of ${p.b.label_count}` : ''}
                {!pack && p.packed > 0 && ` · ${p.packed} ready for dispatch`}
              </div>
              {p.errors.map(e => <div key={e} className="text-xs text-loss mt-0.5">{e}</div>)}
              {p.set.size > 0 && !p.errors.length && <div className="text-xs text-ink/55 mt-0.5">{p.set.size} left over: {compressRanges([...p.set])}</div>}
            </div>
            <input className="input text-sm w-[120px] sm:w-[150px]" inputMode="numeric" placeholder={pack ? 'Not packed' : 'Left over'} value={left[p.b.id] || ''} aria-label={`Labels left over in ${p.b.code}`}
              onChange={e => setLeft(s => ({ ...s, [p.b.id]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div className="text-sm text-ink/70 mb-4">
        <b>{plural(goingNow, 'label')}</b> will be marked {pack ? 'ready for dispatch' : 'dispatched'} by {me?.name || 'you'}{leftOver ? <>, and <b>{leftOver}</b> stay {pack ? 'to pack' : 'waiting — they show in Delayed after the cut-off'}.</> : '.'}
      </div>
      <div className="flex gap-2">
        <button className="btn btn-secondary flex-1" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1" disabled={busy || errors.length > 0 || goingNow === 0 || !answered} onClick={confirm}
          title={!answered ? 'Say what went for the short products first' : undefined}>
          {busy ? 'Marking…' : !answered ? 'Answer the short items first' : `Mark ${plural(goingNow, 'label')} ${pack ? 'ready' : 'dispatched'}`}
        </button>
      </div>
    </Modal>
  )
}

// ── Delayed: printed (or not) but not gone by the cut-off ────────────────────

function DelayedList({ labels, cutoff, me, highlight, showToast, onLog, onChanged, onReprint, canEditCutoff, onCutoff }) {
  const [openId, setOpenId] = useState(null)
  const [picked, setPicked] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [editCutoff, setEditCutoff] = useState(false)
  const [newCutoff, setNewCutoff] = useState(cutoff)
  const today = londonDate()

  const groups = useMemo(() => {
    const m = new Map()
    for (const l of labels) {
      if (!m.has(l.batch_id)) m.set(l.batch_id, { batch: l.batch, labels: [] })
      m.get(l.batch_id).labels.push(l)
    }
    return [...m.values()]
      .map(g => ({ ...g, labels: g.labels.sort((a, b) => a.seq - b.seq) }))
      .sort((a, b) => String(a.batch.ship_date).localeCompare(String(b.batch.ship_date)) || a.batch.code.localeCompare(b.batch.code, undefined, { numeric: true }))
  }, [labels])

  useEffect(() => {
    if (highlight) { const g = labels.find(l => l.id === highlight); if (g) setOpenId(g.batch_id) }
  }, [highlight, labels])

  const chosen = labels.filter(l => picked.has(l.id))
  const act = async (fn, success) => {
    setBusy(true)
    try { await fn(); showToast?.(success); setPicked(new Set()); onChanged() }
    catch (e) { showToast?.(`Didn't work — ${e?.message || 'try again'}`, 'error') }
    finally { setBusy(false) }
  }
  const dispatchChosen = () => act(async () => {
    const n = await dispatchLabelIds(chosen.map(l => l.id), me)
    onLog?.({ entity_type: 'dispatch', entity_name: `${plural(n, 'delayed label')}`, action: 'Dispatched late',
      detail: groupSummary(chosen), source: 'dispatch' })
  }, `${plural(chosen.length, 'label')} marked dispatched`)
  const cancelChosen = () => act(async () => {
    await cancelDispatchLabels(chosen.map(l => l.id), `Cancelled by ${me?.name || 'someone'}`)
    onLog?.({ entity_type: 'dispatch', entity_name: `${plural(chosen.length, 'label')}`, action: 'Cancelled', detail: groupSummary(chosen), source: 'dispatch' })
  }, `${plural(chosen.length, 'label')} cancelled`)

  const cutoffLine = (
    <div className="flex items-center gap-2 text-xs text-ink/50">
      Labels move here if they haven't gone by <b className="text-ink/70">{cutoff}</b> on their dispatch day.
      {canEditCutoff && !editCutoff && <button className="link-chip" onClick={() => setEditCutoff(true)}>Change</button>}
      {editCutoff && (
        <>
          <input type="time" className="input text-xs w-[110px] py-1" value={newCutoff} onChange={e => setNewCutoff(e.target.value)} aria-label="Cut-off time" />
          <button className="btn btn-primary btn-xs" onClick={() => { onCutoff(newCutoff || '18:00'); setEditCutoff(false) }}>Save</button>
        </>
      )}
    </div>
  )

  if (!groups.length) {
    return (
      <>
        <div className="mb-3">{cutoffLine}</div>
        <div className="surface"><EmptyState icon="check" title="Nothing delayed" sub={`Every label due out has gone. Anything not dispatched by ${cutoff} shows up here.`} /></div>
      </>
    )
  }

  return (
    <>
      <div className="mb-3">{cutoffLine}</div>
      {picked.size > 0 && (
        <div className="card mb-4 border-royal-200 bg-royal-50 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-ink"><b>{picked.size}</b> selected
            <button className="link-chip ml-2" onClick={() => setPicked(new Set())}>Clear selection</button>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={cancelChosen}>Cancel</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onReprint(chosen).catch(e => showToast?.(e?.message || 'Couldn\'t print', 'error'))}>
              <Icon name="printer" size={14} /> Reprint
            </button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={dispatchChosen}><Icon name="check" size={14} /> Mark dispatched</button>
          </div>
        </div>
      )}
      <div className="card p-0 overflow-hidden">
        {groups.map(g => {
          const late = daysLate(g.batch.ship_date, today)
          const isOpen = openId === g.batch.id
          const allPicked = g.labels.every(l => picked.has(l.id))
          return (
            <div key={g.batch.id} className="border-b border-rule last:border-0">
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-sky/15">
                <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={allPicked} aria-label={`Select all pending in ${g.batch.code}`}
                  onChange={() => setPicked(s => { const n = new Set(s); g.labels.forEach(l => (allPicked ? n.delete(l.id) : n.add(l.id))); return n })} />
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpenId(isOpen ? null : g.batch.id)}>
                  <div className="text-sm text-ink">
                    <b className="tabular-nums">{g.batch.code}</b> {g.batch.label_name}
                    <span className="text-ink/45"> · {dayOf(g.batch.ship_date)} · {g.batch.carrier} {g.batch.service}</span>
                  </div>
                  <div className="text-xs text-ink/60 mt-0.5">
                    Labels <b>{compressRanges(g.labels.map(l => l.seq))}</b> pending ({g.labels.length} of {g.batch.label_count})
                    {g.labels.some(l => !l.printed_at) && <span className="text-loss"> · {g.labels.filter(l => !l.printed_at).length} never printed</span>}
                  </div>
                </button>
                <StatusBadge tone="alert">{late === 0 ? 'Late today' : `${plural(late, 'day')} late`}</StatusBadge>
                <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={16} className="text-ink/35" />
              </div>
              {isOpen && (
                <div className="bg-paper/60 border-t border-rule">
                  {g.labels.map(l => (
                    <label key={l.id} className={`flex items-center gap-3 pl-11 pr-4 py-2 border-b border-rule last:border-0 cursor-pointer ${highlight === l.id ? 'bg-sky/40' : ''}`}>
                      <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={picked.has(l.id)}
                        onChange={() => setPicked(s => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n })} />
                      <span className="w-14 text-sm font-semibold tabular-nums">{l.seq}/{g.batch.label_count}</span>
                      <span className="flex-1 min-w-0 text-sm text-ink truncate">{l.customer || '—'} <span className="text-ink/45">{l.postcode}</span></span>
                      <span className="text-xs text-ink/50 tabular-nums">{l.channel_ref || l.helm_order}</span>
                      <span className="text-xs w-28 text-right"><LabelStatus label={l} /></span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function groupSummary(labels) {
  const m = new Map()
  for (const l of labels) {
    const k = l.batch?.code || '?'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(l.seq)
  }
  return [...m.entries()].map(([k, seqs]) => `${k} ${compressRanges(seqs)}`).join('; ')
}

// ── Find & reprint ───────────────────────────────────────────────────────────

const REPRINT_REASONS = ['Damaged', 'Ripped', 'Lost', 'Didn\'t print properly', 'Other']

function FindReprint({ me, cutoff, showToast, onLog, onChanged, onReprint, people = [] }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [reprinting, setReprinting] = useState(null)
  const [viewing, setViewing] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < 2) { setResults(null); return }
    timer.current = setTimeout(async () => {
      setSearching(true)
      try { setResults(await searchDispatchLabels(q)) } catch { setResults([]) } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(timer.current)
  }, [q])

  const refresh = async () => { if (q.trim().length >= 2) setResults(await searchDispatchLabels(q)); onChanged() }

  return (
    <>
      <div className="filter-bar mb-4">
        <SearchInput value={q} onChange={e => setQ(e.target.value)} autoFocus
          placeholder="Order reference, postcode, customer name or tracking number…" className="flex-1 min-w-[240px]" />
        {searching && <div className="text-xs text-ink/45">Searching…</div>}
      </div>

      {results === null ? (
        <div className="surface">
          <EmptyState icon="search" title="Find a label to reprint"
            sub="Type anything you have — the order reference, the postcode, the customer's name or the tracking number. You'll see what's in the parcel before you print." />
        </div>
      ) : results.length === 0 ? (
        <div className="surface"><EmptyState icon="search" title="No labels found" sub="Check the spelling, or try the postcode or order reference instead." /></div>
      ) : (
        <div className="space-y-2">
          {results.map(l => {
            const late = l.status === 'ready' && isDelayed(l.batch?.ship_date, { cutoff })
            return (
              <div key={l.id} className="card flex items-start gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold text-ink">{l.label_name || l.batch?.label_name}</div>
                  <div className="text-sm text-ink/70">{itemsText(l.items)}</div>
                  <div className="text-sm text-ink mt-1.5">{l.customer || '—'} <span className="text-ink/50">{l.postcode}</span></div>
                  <div className="text-xs text-ink/50 mt-0.5 tabular-nums">
                    {[l.channel_ref, l.helm_order].filter(Boolean).join(' · ')}{l.tracking ? <>{(l.channel_ref || l.helm_order) ? ' · ' : ''}<Tracking l={l} /></> : null}
                  </div>
                  <div className="text-xs text-ink/50 mt-0.5">
                    {l.batch ? <>Batch <b className="text-ink/70">{l.batch.code}</b> · label {l.seq} of {l.batch.label_count} · {dayOf(l.batch.ship_date)} · {l.batch.carrier} {l.batch.service}</> : 'Not in a batch'}
                    {l.reprint_count > 0 && <> · reprinted {l.reprint_count}× (last: {l.last_reprint_reason || 'no reason'}, {l.last_reprinted_by_name || 'someone'})</>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {l.status === 'dispatched' ? <StatusBadge tone="live" dot>Dispatched</StatusBadge>
                    : l.status === 'cancelled' ? <StatusBadge tone="quiet">Cancelled</StatusBadge>
                    : late ? <StatusBadge tone="alert" dot>Delayed</StatusBadge>
                    : <StatusBadge tone="brand" dot>{l.printed_at ? 'Printed' : 'Not printed'}</StatusBadge>}
                  <div className="flex gap-2">
                    {l.batch?.upload?.storage_path && (
                      <button className="btn btn-secondary btn-sm" onClick={() => setViewing(l)}><Icon name="eye" size={14} /> View label</button>
                    )}
                    {l.status !== 'cancelled' && l.batch && (
                      <button className="btn btn-primary btn-sm" onClick={() => setReprinting(l)}><Icon name="printer" size={14} /> Reprint</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viewing && (
        <Modal title={`${viewing.batch?.code} · label ${viewing.seq} of ${viewing.batch?.label_count}`} maxWidth="max-w-lg"
          description={[viewing.channel_ref || viewing.helm_order, viewing.tracking].filter(Boolean).join(' · ')} onClose={() => setViewing(null)}>
          <LabelImage label={viewing} />
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setViewing(null)}>Close</button>
            {viewing.status !== 'cancelled' && viewing.batch && (
              <button className="btn btn-primary flex-1 justify-center" onClick={() => { const l = viewing; setViewing(null); setReprinting(l) }}>
                <Icon name="printer" size={14} /> Reprint this
              </button>
            )}
          </div>
        </Modal>
      )}
      {reprinting && (
        <ReprintModal label={reprinting} me={me} people={people} showToast={showToast} onLog={onLog} onReprint={onReprint}
          onClose={() => setReprinting(null)} onDone={() => { setReprinting(null); refresh() }} />
      )}
    </>
  )
}

function ReprintModal({ label, me, people = [], showToast, onLog, onReprint, onClose, onDone }) {
  const [reason, setReason] = useState('Damaged')
  const [person, setPerson] = useState(lastPerson || '')
  const [dispatchNow, setDispatchNow] = useState(false)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await onReprint([label], person)
      await markLabelReprinted(label, reason, me, person)
      if (dispatchNow && label.status === 'ready') await dispatchLabelIds([label.id], me)
      onLog?.({ entity_type: 'dispatch', entity_id: label.id, entity_name: `${label.batch?.code} ${label.seq}/${label.batch?.label_count} · ${label.label_name}`,
        action: 'Label reprinted', detail: `${reason}${person ? ` · by ${person}` : ''}${label.status === 'dispatched' ? ' · was already dispatched' : ''} · ${label.customer || ''} ${label.postcode || ''}`.trim(), source: 'dispatch' })
      onDone()
    } catch (e) { showToast?.(`Couldn't reprint — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
  }
  return (
    <Modal title="Reprint this label" description={`${label.batch?.code} · label ${label.seq} of ${label.batch?.label_count}`} onClose={onClose}>
      {label.batch?.upload?.storage_path && <LabelImage label={label} compact className="mb-4" />}
      <div className="card mb-4">
        <div className="text-lg font-semibold text-ink">{label.label_name}</div>
        <div className="text-sm text-ink/70">{itemsText(label.items)}</div>
        <div className="text-sm text-ink mt-2">{label.customer} <span className="text-ink/50">{label.postcode}</span></div>
        <div className="text-xs text-ink/50">{[label.channel_ref, label.tracking].filter(Boolean).join(' · ')}</div>
      </div>
      {label.status === 'dispatched' && (
        <WarnBox title="Already dispatched">
          This label was marked dispatched{label.dispatched_by_name ? ` by ${label.dispatched_by_name}` : ''} at {timeOf(label.dispatched_at)} on {dayOf(label.dispatched_at)}. Reprinting gives a second copy of the same label — only stick it on the same parcel.
        </WarnBox>
      )}
      <div className="mt-4">
        <label className="label" htmlFor="rp-reason">Why?</label>
        <select id="rp-reason" className="input" value={reason} onChange={e => setReason(e.target.value)}>
          {REPRINT_REASONS.map(r => <option key={r}>{r}</option>)}
        </select>
      </div>
      <div className="mt-3">
        <div className="label">Who's printing it?</div>
        <div className="flex gap-2 flex-wrap">
          {people.map(n => <button key={n} className={`btn btn-sm ${person === n ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPerson(n)}>{n}</button>)}
        </div>
      </div>
      {label.status === 'ready' && (
        <label className="flex items-center gap-2.5 mt-3 text-sm text-ink/65 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={dispatchNow} onChange={e => setDispatchNow(e.target.checked)} />
          It's going out now — mark it dispatched too
        </label>
      )}
      <div className="flex gap-2 pt-4">
        <button className="btn btn-secondary flex-1" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1" disabled={busy || !person} onClick={go}><Icon name="printer" size={14} /> {busy ? 'Building…' : person ? `Print 1 label · ${person}` : 'Choose who\'s printing'}</button>
      </div>
    </Modal>
  )
}

// ── A label as it prints ─────────────────────────────────────────────────────

const labelFiles = new Map()   // upload file → its bytes, so looking at a few labels downloads it once
const labelImages = new Map()  // label id → picture

/**
 * The label exactly as a reprint comes out — the HELM label with the product
 * stamped on it — built the same way printing builds it, then shown as a picture.
 */
function LabelImage({ label, compact = false, className = '' }) {
  const [src, setSrc] = useState(labelImages.get(label.id) || null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (labelImages.has(label.id)) return
    let gone = false
    ;(async () => {
      try {
        const path = label.batch?.upload?.storage_path
        if (!labelFiles.has(path)) labelFiles.set(path, downloadDispatchFile(path))
        const fileBytes = await labelFiles.get(path)
        const bytes = await buildPrintFile([{ batch: label.batch, labels: [label], fileBytes }], { cover: false })
        const [img] = await pagesAsImages(bytes, [0], compact ? 1.2 : 1.8)
        if (!img) throw new Error('Nothing to show')
        labelImages.set(label.id, img)
        if (!gone) setSrc(img)
      } catch (e) { if (!gone) setError(e?.message || 'Couldn’t show the label') }
    })()
    return () => { gone = true }
  }, [label.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`rounded-[6px] border border-rule bg-white overflow-hidden flex items-center justify-center ${compact ? 'max-h-72' : 'min-h-[18rem]'} ${className}`}>
      {src ? <img src={src} alt={`Label ${label.seq} — ${label.label_name || ''}`} className={`w-full object-contain ${compact ? 'max-h-72' : 'max-h-[70dvh]'}`} />
        : error ? <div className="px-4 py-10 text-sm text-loss text-center">{error}</div>
        : <div className="py-10"><Spinner /><div className="text-xs text-ink/45 text-center -mt-6">Building the label…</div></div>}
    </div>
  )
}

// ── One batch: one uploaded file, split into its products ────────────────────

function BatchCard({ file, statOf, picked, printing, responsible, onPick, onPrintBatch, onPrintGroup, onOpenGroup, onDispatch, onPack, onPickList, onSubstitute }) {
  const g = file.groups
  const [open, setOpen] = useState(g.length <= 12)
  const tally = g.reduce((t, x) => {
    const st = statOf(x)
    if (!x.printed_at) t.toPrint += st.ready
    else t.printed += st.ready - st.packed
    t.ready += st.packed; t.gone += st.dispatched; t.total += st.ready + st.dispatched
    return t
  }, { toPrint: 0, printed: 0, ready: 0, gone: 0, total: 0 })
  const orders = g.reduce((s, x) => s + x.order_count, 0)
  const printedAll = g.every(x => x.printed_at)
  const printedSome = g.some(x => x.printed_at)
  const waiting = tally.toPrint + tally.printed + tally.ready
  const unpacked = tally.printed
  const busy = printing && g.some(x => printing.includes(x.id))
  const carriers = [...new Set(g.map(x => x.carrier).filter(Boolean))]
  const lastPrint = g.filter(x => x.printed_at).sort((a, b) => String(b.printed_at).localeCompare(String(a.printed_at)))[0]
  const doneAll = tally.total > 0 && tally.gone === tally.total

  // One obvious next step for the batch, the rest alongside
  const next = !printedAll
    ? { label: busy ? 'Building…' : printedSome ? 'Print the rest' : 'Print batch', icon: 'printer', run: onPrintBatch, disabled: !!printing }
    : unpacked > 0 ? { label: 'Ready for dispatch', icon: 'layers', run: () => onPack() }
      : waiting > 0 ? { label: 'Mark dispatched', icon: 'check', run: () => onDispatch() }
        : null

  return (
    <div className={`card p-0 overflow-hidden ${picked ? 'ring-2 ring-royal-300' : ''} ${doneAll ? 'opacity-80' : ''}`}>
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <input type="checkbox" className="hidden sm:block w-4 h-4 mt-2 accent-royal-500" checked={picked} onChange={onPick} aria-label={`Select batch ${file.code}`} />
          <button className="shrink-0 min-w-[52px] h-11 px-2 rounded-[6px] bg-sky/70 text-royal-700 text-lg font-semibold tabular-nums" onClick={() => setOpen(o => !o)}
            aria-expanded={open} title={open ? 'Hide products' : 'Show products'}>{file.code}</button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {responsible ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <span className="w-6 h-6 rounded-full bg-royal-500 text-white text-[11px] flex items-center justify-center">{responsible.charAt(0).toUpperCase()}</span>
                  {responsible}
                </span>
              ) : <span className="text-sm text-ink/45">Nobody yet</span>}
              {file.upload.title && <span className="text-sm text-ink/55 truncate">· {file.upload.title}</span>}
            </div>
            <div className="text-xs text-ink/50 mt-0.5">
              {plural(tally.total, 'label')} · {plural(orders, 'order')} · {plural(g.length, 'product')}{carriers.length ? ` · ${carriers.join(', ')}` : ''}
              {lastPrint ? ` · printed ${timeOf(lastPrint.printed_at)}` : file.upload.created_at ? ` · uploaded ${timeOf(file.upload.created_at)}` : ''}
            </div>
          </div>
          <div className="shrink-0 text-right">
            {doneAll ? <StatusBadge tone="live" dot>Dispatched</StatusBadge>
              : <div className="text-sm font-semibold tabular-nums text-ink">{tally.gone}<span className="text-ink/40 font-normal">/{tally.total}</span></div>}
            {!doneAll && <div className="text-[10px] uppercase tracking-wide text-ink/40">gone</div>}
          </div>
        </div>
        <BatchBar counts={tally} total={tally.total} />
        <div className="flex flex-wrap gap-2 mt-3">
          {next && (
            <button className="btn btn-primary btn-sm flex-1 sm:flex-none justify-center py-2.5 sm:py-2" disabled={next.disabled} onClick={next.run}>
              <Icon name={next.icon} size={14} /> {next.label}
            </button>
          )}
          {waiting > 0 && (
            <button className="btn btn-secondary btn-sm flex-1 sm:flex-none justify-center py-2.5 sm:py-2" onClick={onPickList}><Icon name="list" size={14} /> Pick list</button>
          )}
          {next && next.label === 'Ready for dispatch' && waiting > 0 && (
            <button className="btn btn-secondary btn-sm justify-center py-2.5 sm:py-2" onClick={() => onDispatch()}><Icon name="check" size={14} /> Dispatched</button>
          )}
          <button className="btn btn-secondary btn-sm justify-center py-2.5 sm:py-2" onClick={onSubstitute} title="Something else went instead — before or after dispatch">
            <Icon name="swap" size={14} /> Substitute
          </button>
          {printedAll && (
            <button className="btn btn-ghost btn-sm justify-center py-2.5 sm:py-2" disabled={!!printing} onClick={onPrintBatch} title="Print the whole batch again">
              <Icon name="printer" size={14} /> {busy ? 'Building…' : 'Print again'}
            </button>
          )}
        </div>
      </div>
      {open && (
        <ul className="border-t border-rule divide-y divide-rule/70">
          {g.map(x => {
            const st = statOf(x)
            return (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sky/20 cursor-pointer" onClick={() => onOpenGroup(x)}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink leading-snug">{x.label_name}</div>
                  <div className="text-xs text-ink/45 mt-0.5">
                    {x.contents && x.contents.toUpperCase() !== x.label_name.toUpperCase() ? `${x.contents} · ` : ''}{x.carrier} {x.service}
                  </div>
                  <div className="mt-1 sm:hidden"><BatchStatus batch={x} stat={st} /></div>
                </div>
                <div className="hidden sm:block shrink-0 w-[150px]"><BatchStatus batch={x} stat={st} /></div>
                <div className="shrink-0 text-right tabular-nums w-10">
                  <div className="text-base font-semibold text-ink leading-none">{x.label_count}</div>
                  <div className="text-[10px] text-ink/40">label{x.label_count !== 1 ? 's' : ''}</div>
                </div>
                <div className="shrink-0 flex gap-1.5" onClick={e => e.stopPropagation()}>
                  {x.printed_at && st.ready - st.packed > 0 && (
                    <button className="btn btn-secondary btn-xs" onClick={() => onPack([x])} title="This product is packed — waiting for collection">Ready</button>
                  )}
                  {x.printed_at && st.ready > 0 && st.ready === st.packed && (
                    <button className="btn btn-secondary btn-xs" onClick={() => onDispatch([x])}>Sent</button>
                  )}
                  {!x.printed_at && (
                    <button className="btn btn-secondary btn-xs" disabled={!!printing} onClick={() => onPrintGroup(x)} title="Print just this product, with its cover page">
                      <Icon name="printer" size={13} /><span className="hidden sm:inline">{printing?.includes(x.id) && printing.length === 1 ? '…' : 'Print'}</span>
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** One bar for a set of labels: to print, picking & packing, ready, gone. */
function BatchBar({ counts, total, className = 'mt-3' }) {
  if (!total) return null
  const seg = [['toPrint', 'bg-ink/15'], ['printed', 'bg-royal-300'], ['ready', 'bg-royal-500'], ['gone', 'bg-lime']]
  return (
    <div className={`flex h-2 rounded-full overflow-hidden bg-ink/5 ${className}`} aria-hidden="true">
      {seg.map(([k, c]) => counts[k] > 0 && <div key={k} className={c} style={{ width: `${(counts[k] / total) * 100}%` }} />)}
    </div>
  )
}

/** The day's labels from printing to the van, as one picture. Each stage opens what's in it. */
function FlowBar({ stages, total }) {
  return (
    <section className="card p-0 mb-4 overflow-hidden" aria-label="Today's labels by stage">
      <div className="flex h-2.5 bg-ink/5">
        {total > 0 && stages.map(s => s.value > 0 && <div key={s.id} className={s.color} style={{ width: `${(s.value / total) * 100}%` }} />)}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-rule/70">
        {stages.map((s, i) => {
          const Tag = s.onClick ? 'button' : 'div'
          return (
            <Tag key={s.id} onClick={s.onClick || undefined}
              className={`text-left px-3.5 py-3 ${i >= 2 ? 'border-t border-rule/70 sm:border-t-0' : ''} ${s.onClick ? 'hover:bg-sky/25 transition-colors' : ''} ${s.active ? 'bg-sky/40' : ''}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink/55"><span className={`w-2 h-2 rounded-full ${s.dot}`} />{s.label}</div>
              <div className="text-2xl font-semibold tabular-nums text-ink leading-tight mt-0.5">{s.value}</div>
              <div className="text-[11px] text-ink/40">{s.hint || (total ? `${Math.round((s.value / total) * 100)}% of ${total}` : 'labels')}</div>
            </Tag>
          )
        })}
      </div>
    </section>
  )
}

/** The less-used actions, tucked behind "…" so the main one stands out. */
function MoreMenu({ items = [] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  if (!items.length) return null
  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-secondary btn-sm px-2.5 h-full" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-64 bg-white border border-rule rounded-[6px] shadow-lift py-1">
          {items.map(it => (
            <button key={it.label} role="menuitem" className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-sky/30"
              onClick={() => { setOpen(false); it.run?.() }}>
              {it.icon && <Icon name={it.icon} size={15} className="mt-0.5 text-ink/50 shrink-0" />}
              <span><span className="block text-sm text-ink">{it.label}</span>{it.hint && <span className="block text-[11px] text-ink/45">{it.hint}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Files being read in the background ───────────────────────────────────────

function jobLine(job) {
  const p = job.progress
  if (job.status === 'reading') return p ? `Reading — page ${p.page} of ${p.pages}` : 'Opening the file…'
  if (job.status === 'saving') return 'Saving the batch…'
  if (job.status === 'saved') return `Saved as batch ${job.result?.upload?.code} · ${plural(job.labels || 0, 'label')}${job.shipDate && job.shipDate !== londonDate() ? ` — for ${dayOf(job.shipDate)}, not today's list` : ' — ready to print'}`
  if (job.status === 'review') return `Read — ${plural(job.needsYou || 0, 'order')} need${job.needsYou === 1 ? 's' : ''} a look before it's saved`
  return `Couldn't read it — ${job.error}`
}

function JobCard({ job, onReview, onShow }) {
  const p = job.progress
  const pct = p ? Math.round((p.page / Math.max(1, p.pages)) * 100) : 4
  const tone = job.status === 'review' || job.status === 'error' ? 'border-l-2 border-l-coral' : job.status === 'saved' ? 'border-l-2 border-l-lime' : ''
  return (
    <div className={`card flex items-center gap-4 flex-wrap ${tone}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink truncate"><b>{job.meta?.title || job.name}</b>{job.meta?.picker ? <span className="text-ink/50"> · {job.meta.picker}</span> : null}</div>
        <div className="text-xs text-ink/55 mt-0.5">{jobLine(job)}</div>
        {(job.status === 'reading' || job.status === 'saving') && (
          <div className="mt-2 h-1.5 bg-ink/10 rounded-full overflow-hidden max-w-md">
            <div className="h-full bg-royal-500 transition-all" style={{ width: `${job.status === 'saving' ? 100 : pct}%` }} />
          </div>
        )}
      </div>
      {job.status === 'review' && <button className="btn btn-primary btn-sm" onClick={onReview}>Review &amp; save</button>}
      {job.status === 'saved' && <button className="btn btn-secondary btn-sm" onClick={onShow}>Show batch</button>}
      {(job.status === 'error' || job.status === 'saved') && (
        <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => dismissJob(job.id)}><Icon name="close" size={15} /></button>
      )}
    </div>
  )
}

/**
 * Shown anywhere in the portal while a file is being read, so nobody has to
 * sit on the Dispatch page — and it says when a batch is ready or needs a look.
 */
export function DispatchJobsPill({ onOpen, showToast }) {
  const [jobs, setJobs] = useState([])
  useEffect(() => subscribeJobs((list) => {
    setJobs(list)
    for (const j of list) {
      if (toldJobs.get(j.id) === j.status) continue
      toldJobs.set(j.id, j.status)
      if (j.status === 'saved') showToast?.(`Batch ${j.result?.upload?.code} is ready — ${plural(j.labels || 0, 'label')}${j.shipDate && j.shipDate !== londonDate() ? ` for ${dayOf(j.shipDate)}` : ''}`, 'success', { label: 'Open', run: onOpen })
      if (j.status === 'review') showToast?.(`${j.meta?.title || j.name} has been read — ${plural(j.needsYou || 0, 'order')} need a look`, 'success', { label: 'Review', run: onOpen })
      if (j.status === 'error') showToast?.(`Couldn't read ${j.name}`, 'error')
    }
  }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const active = jobs.filter(j => j.status === 'reading' || j.status === 'saving')
  const waiting = jobs.filter(j => j.status === 'review')
  if (!active.length && !waiting.length) return null
  const p = active[0]?.progress
  return (
    <button onClick={onOpen}
      className="fixed bottom-4 left-4 z-40 card py-2.5 px-3.5 shadow-lg flex items-center gap-2.5 text-left hover:border-royal-300 transition-colors max-w-[320px]">
      <Icon name="printer" size={16} className={active.length ? 'text-royal-500 animate-pulse' : 'text-loss'} />
      <span className="text-xs text-ink">
        {active.length
          ? <>Reading labels{p ? ` — ${p.page}/${p.pages}` : '…'}{active.length > 1 ? ` · ${active.length} files` : ''}</>
          : <>{plural(waiting.length, 'upload')} waiting for a look</>}
      </span>
    </button>
  )
}

// ── Labels with no packing slip ──────────────────────────────────────────────

const REASONS = [['replacement', 'Replacement'], ['manual', 'Manual order'], ['other', 'Other']]

/** Finds the parcel mapping that covers what a past order held. */
function mappingForItems(items, mappings) {
  const key = itemKey(items)
  const exact = mappings.find(m => m.item_key === key)
  if (exact) return { mapping: exact, qty: 1 }
  const codes = [...new Set((items || []).map(i => String(i.code).toUpperCase().replace(/[^A-Z0-9]/g, '')))]
  if (codes.length === 1) {
    const any = mappings.find(m => m.item_key === `${codes[0]}x*`)
    if (any) return { mapping: any, qty: (items || []).reduce((s, i) => s + (parseInt(i.qty, 10) || 0), 0) }
  }
  return null
}

function ProductPicker({ value, mappings, onChange }) {
  const sorted = [...mappings].sort((a, b) => a.label_name.localeCompare(b.label_name))
  const anyQty = value?.mapping && String(value.mapping.item_key).endsWith('x*')
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select className="input text-sm flex-1 min-w-[220px]" value={value?.mapping?.item_key || ''}
        onChange={e => { const m = mappings.find(x => x.item_key === e.target.value); onChange({ ...(value || {}), mapping: m || null, qty: value?.qty || 1 }) }}>
        <option value="">Choose the product…</option>
        {sorted.map(m => <option key={m.item_key} value={m.item_key}>{m.label_name}{String(m.item_key).endsWith('x*') ? ' (any qty)' : ''}</option>)}
      </select>
      {anyQty && (
        <input className="input text-sm w-[80px]" type="number" min="1" value={value.qty || 1} aria-label="How many"
          onChange={e => onChange({ ...value, qty: e.target.value })} />
      )}
      <select className="input text-sm w-[150px]" value={value?.reason || 'replacement'} aria-label="Why it's going out"
        onChange={e => onChange({ ...(value || {}), reason: e.target.value })}>
        {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

function ManualLabels({ orders, mappings, history, manual, onChange, onAll }) {
  const loose = orders.map((o, i) => ({ o, id: `o${i}` })).filter(x => !x.o.slip)
  return (
    <div className="space-y-2">
      {loose.map(({ o, id }, n) => {
        const l = o.labels[0] || {}
        const v = manual[id] || {}
        const past = history.filter(h => samePostcode(h.postcode, l.postcode, 1)).slice(0, 3)
        return (
          <div key={id} className={`card ${v.mapping ? '' : 'border-l-2 border-l-coral'}`}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="text-sm text-ink">
                {l.customer || 'Customer not read'}{l.postcode && <span className="text-ink/45"> · {l.postcode}</span>}
                <span className="text-xs text-ink/40"> · {l.carrier || '?'} {l.service || ''} · page {(l.pageIndex ?? 0) + 1}{l.tracking ? ` · ${l.tracking}` : ''}</span>
              </div>
              {v.mapping && <StatusBadge tone="live">{v.reason === 'manual' ? 'Manual order' : v.reason === 'other' ? 'Other' : 'Replacement'}</StatusBadge>}
            </div>
            {past.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {past.map((h, k) => {
                  const found = mappingForItems(h.items, mappings)
                  return (
                    <button key={k} className="link-chip text-xs" disabled={!found}
                      onClick={() => found && onChange(id, { ...v, mapping: found.mapping, qty: found.qty, reason: 'replacement', originalRef: h.channel_ref || '' })}
                      title={found ? 'Fill in from this order' : 'That product isn\'t set up any more'}>
                      Replacement for {h.channel_ref || 'an earlier order'} — {itemsText(h.items)} ({h.upload?.code} {dayOf(h.upload?.ship_date || h.created_at)})
                    </button>
                  )
                })}
              </div>
            )}
            <div className="mt-2.5">
              <ProductPicker value={v} mappings={mappings} onChange={(nv) => onChange(id, nv)} />
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <input className="input text-sm flex-1 min-w-[200px]" placeholder="Original order ref — optional" value={v.originalRef || ''}
                onChange={e => onChange(id, { ...v, originalRef: e.target.value })} />
              <input className="input text-sm flex-1 min-w-[200px]" placeholder="Note — e.g. arrived broken" value={v.note || ''}
                onChange={e => onChange(id, { ...v, note: e.target.value })} />
              {v.mapping && n < loose.length - 1 && loose.slice(n + 1).some(x => !manual[x.id]?.mapping) && (
                <button className="btn btn-secondary btn-xs" onClick={() => onAll({ mapping: v.mapping, qty: v.qty, reason: v.reason || 'replacement' })}>
                  Same for the rest
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────

// This week runs Monday to today, London time
const sinceMonday = () => {
  const d = new Date(londonDate() + 'T12:00:00')
  return (d.getDay() + 6) % 7
}
const RANGES = [['today', 'Today', () => 0], ['week', 'This week', sinceMonday], ['7', '7 days', () => 6], ['30', '30 days', () => 29], ['90', '90 days', () => 89]]
const daysAgo = (n) => londonDate(new Date(Date.now() - n * 86400000))

/**
 * What went out: orders, parcels and real units per product — 3-packs and
 * singles rolled up into one total — replacements kept apart, and how well
 * the cut-off was kept.
 */
/**
 * The Dispatch dashboard: its own page, so Dispatch stays about labels.
 */
export function DispatchDashboardPage({ me, settings, showToast }) {
  const cutoff = settings?.dispatch?.cutoff || '18:00'
  const people = settings?.dispatch?.people?.length ? settings.dispatch.people : ['Ankesh', 'Sagar']
  return (
    <div>
      <PageHeader eyebrow="Warehouse / dispatch dashboard" title="Dispatch dashboard"
        description="What went out: orders and real units per product, who packed and dispatched them, and how well the cut-off was kept." />
      <DispatchDashboard me={me} cutoff={cutoff} showToast={showToast} people={people} />
    </div>
  )
}

function DispatchDashboard({ me, cutoff, showToast, people = [] }) {
  const [range, setRange] = useState('7')
  const [person, setPerson] = useState('')
  const [view, setView] = useState('products')     // products, orders
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(londonDate())
  const [labels, setLabels] = useState(null)
  const [units, setUnits] = useState([])
  const [subs, setSubs] = useState([])
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLabels(null)
    try {
      const [l, u, sb] = await Promise.all([loadDashboardLabels({ from, to }), loadItemUnits(), loadSubstitutes({ from, to }).catch(() => [])])
      setLabels(l); setUnits(u); setSubs(sb)
    } catch (e) { showToast?.(`Couldn't load the dashboard — ${e?.message || 'try again'}`, 'error'); setLabels([]) }
  }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const unitsByCode = useMemo(() => new Map(units.map(u => [u.code_key, u])), [units])
  const sum = useMemo(() => (labels ? summariseDispatch(labels, unitsByCode, { cutoff, person }) : null), [labels, unitsByCode, cutoff, person])
  const everyone = useMemo(() => (labels ? summariseDispatch(labels, unitsByCode, { cutoff }) : null), [labels, unitsByCode, cutoff])
  const names = [...new Set([...people, ...(everyone?.people || []).map(p => p.name)])].filter(n => n && n !== 'Not recorded')
  const pick = (id, n) => { setRange(id); setFrom(daysAgo(n())); setTo(londonDate()) }
  // Substitutes: what ran out and what went instead, most often first
  const subsShown = person ? subs.filter(x => x.by_name === person) : subs
  const subPairs = useMemo(() => {
    const m = new Map()
    for (const x of subsShown) {
      const k = `${x.product_id}|${x.sub_product_id}`
      if (!m.has(k)) m.set(k, { k, from: x.product_name, to: x.sub_name, orders: 0, units: 0, by: new Set() })
      const r = m.get(k); r.orders++; r.units += Number(x.units) || 0; if (x.by_name) r.by.add(x.by_name)
    }
    return [...m.values()].sort((a, b) => b.orders - a.orders)
  }, [subsShown])

  return (
    <div className="space-y-4">
      <div className="filter-bar">
        <div className="flex gap-1.5 flex-wrap">
          {RANGES.map(([id, label, n]) => (
            <button key={id} className={`btn btn-sm ${range === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pick(id, n)}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink/55">
          <input type="date" className="input text-sm w-[145px]" value={from} max={to} onChange={e => { setRange('custom'); setFrom(e.target.value || from) }} aria-label="From" />
          to
          <input type="date" className="input text-sm w-[145px]" value={to} min={from} max={londonDate()} onChange={e => { setRange('custom'); setTo(e.target.value || to) }} aria-label="To" />
        </div>
        <select className="input text-sm sm:w-[160px] sm:ml-auto" value={person} onChange={e => setPerson(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {!sum ? <Spinner /> : sum.orders === 0 ? (
        <div className="surface"><EmptyState icon="printer" title="Nothing dispatched in these dates" sub="Pick a wider range, or upload a batch." /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
            <Metric label="Orders" value={sum.orders} sub={plural(sum.parcels, 'parcel')} />
            <Metric label="Units dispatched" value={sum.unitsGone} sub={sum.unitsWaiting ? `${sum.unitsWaiting} still to go` : 'all gone'} tone="text-royal-600" />
            <Metric label="Replacements" value={sum.replacements} sub={plural(sum.replacementUnits, 'unit')} tone={sum.replacements ? 'text-loss' : ''} />
            <Metric label="On time" value={sum.onTimePct == null ? '—' : `${sum.onTimePct}%`} sub={`gone by ${cutoff}`}
              tone={sum.onTimePct == null ? '' : sum.onTimePct >= 95 ? 'text-gain' : sum.onTimePct < 80 ? 'text-loss' : ''} />
            <Metric label="Reprints" value={sum.reprints} sub="labels printed again" />
            <Metric label="Substitutes" value={subsShown.length} sub={subsShown.length ? `${Math.round((subsShown.length / Math.max(1, sum.orders)) * 1000) / 10}% of orders` : 'none sent'}
              tone={subsShown.length ? 'text-warn' : ''} />
            <Metric label="Carriers" value={sum.carriers.map(c => `${c.name} ${c.n}`).join(' · ') || '—'} sub="parcels" />
          </div>

          {sum.unconfirmed.length > 0 && (
            <div className="card border-l-2 border-l-coral">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-ink">
                  <b>{plural(sum.unconfirmed.length, 'item code')}</b> counted from a guess
                  <span className="text-ink/55"> — check what each one is (e.g. a 3-pack is 3 units) and the figures are exact, past days included.</span>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(e => !e)}>{editing ? 'Close' : 'Check them'}</button>
              </div>
              {editing && (
                <UnitsEditor codes={sum.unconfirmed} labels={labels} units={unitsByCode} me={me} showToast={showToast}
                  onSaved={(rows) => { setUnits(u => [...u.filter(x => !rows.some(r => r.code_key === x.code_key)), ...rows]); setEditing(false) }} />
              )}
            </div>
          )}

          {/* Who dispatched what, day by day */}
          {!person && everyone.people.length > 0 && (
            <PeopleTable people={everyone.people} days={everyone.days.map(d => d.day)} onPick={setPerson} />
          )}

          {sum.days.length > 1 && <DayBars days={sum.days} />}

          <div className="flex items-center gap-1.5">
            <button className={`btn btn-sm ${view === 'products' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('products')}>Products · units</button>
            <button className={`btn btn-sm ${view === 'orders' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('orders')}>Orders · as stamped</button>
            {person && <span className="text-xs text-ink/55 ml-2">Showing <b>{person}</b> · <button className="link-chip" onClick={() => setPerson('')}>everyone</button></span>}
          </div>

          {view === 'products' ? (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule bg-paper">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink/45">Product</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Orders</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Units dispatched</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Still to go</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-ink/45">Replacements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sum.products.map(p => (
                      <tr key={p.base} className="border-b border-rule last:border-0">
                        <td className="px-4 py-2.5 text-ink">{p.base}{p.guessed && <span className="text-xs text-ink/40" title="Includes a guessed pack size"> ≈</span>}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.orders}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{p.gone}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink/55">{p.waiting || '—'}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${p.replacements ? 'text-loss' : 'text-ink/35'}`}>{p.replacements || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule bg-paper">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-ink/45">Stamped on the label</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Orders</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Dispatched</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Parcels</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-ink/45">Replacements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sum.stamps.map(st => (
                      <tr key={st.name} className="border-b border-rule last:border-0">
                        <td className="px-4 py-2.5 text-ink font-medium">{st.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{st.orders}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{st.gone}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink/55">{st.parcels}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${st.replacements ? 'text-loss' : 'text-ink/35'}`}>{st.replacements || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {subPairs.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-rule">
                <div className="text-sm font-semibold text-ink">Substitutes sent</div>
                <div className="text-xs text-ink/50">Ran out, and something else went instead. Stock came off the product that went.</div>
              </div>
              <ul className="divide-y divide-rule/70">
                {subPairs.map(r => (
                  <li key={r.k} className="px-4 py-2.5 flex items-start gap-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="text-ink/55 leading-snug">{r.from}</div>
                      <div className="text-ink font-medium leading-snug flex items-start gap-1.5"><Icon name="arrowRight" size={13} className="mt-1 shrink-0 text-ink/35" />{r.to}</div>
                      {r.by.size > 0 && <div className="text-[11px] text-ink/40 mt-0.5">by {[...r.by].join(', ')}</div>}
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="text-sm font-semibold text-ink">{plural(r.orders, 'order')}</div>
                      <div className="text-[11px] text-ink/45">{plural(r.units, 'unit')} sent</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="text-xs text-ink/45">Units count as dispatched once every label in their order is marked dispatched. Replacements aren't counted as sales.</div>
        </>
      )}
    </div>
  )
}

/** Confirm what each item code is: the base product and how many units one of it holds. */
function UnitsEditor({ codes, labels, units, me, showToast, onSaved }) {
  const nameOf = (code) => {
    for (const l of labels || []) for (const it of l.items || []) if (normRef(it.code) === normRef(code)) return it.name || ''
    return ''
  }
  const [rows, setRows] = useState(() => codes.map(c => {
    const k = normRef(c.code)
    const known = units.get(k)
    const name = known?.name || nameOf(c.code)
    const g = known || guessUnits({ code: c.code, name })
    return { code_key: k, code: c.code, name, base_product: g.base_product, units: g.units }
  }))
  const [busy, setBusy] = useState(false)
  const bases = [...new Set([...units.values()].map(u => u.base_product).concat(rows.map(r => r.base_product)))].sort()
  const set = (i, patch) => setRows(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className="mt-3">
      <datalist id="dp-bases">{bases.map(b => <option key={b} value={b} />)}</datalist>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.code_key} className="grid grid-cols-1 sm:grid-cols-[1.3fr_1.5fr_90px] gap-2 items-center">
            <div className="min-w-0">
              <div className="text-xs text-ink truncate">{r.name || r.code}</div>
              <div className="text-[11px] text-ink/40 truncate">{r.code}</div>
            </div>
            <input className="input text-sm" list="dp-bases" value={r.base_product} aria-label="Base product"
              onChange={e => set(i, { base_product: e.target.value })} />
            <div className="flex items-center gap-1.5">
              <input className="input text-sm w-[64px]" type="number" min="1" value={r.units} aria-label="Units"
                onChange={e => set(i, { units: e.target.value })} />
              <span className="text-xs text-ink/45">units</span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-ink/45 mt-2">Give packs of the same thing the same base product — "Sanmex Fly &amp; Wasp Killer 300ml" for the single, the 2-pack and the 3-pack — and they add up together.</div>
      <div className="flex justify-end mt-3">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
          setBusy(true)
          try { onSaved(await saveItemUnits(rows.map(r => ({ ...r, confirmed: true })), me)); showToast?.('Units saved — the figures are exact now') }
          catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error') }
          finally { setBusy(false) }
        }}>{busy ? 'Saving…' : `Confirm ${plural(rows.length, 'item')}`}</button>
      </div>
    </div>
  )
}

// ── Who's printing ───────────────────────────────────────────────────────────

/**
 * Asked every time something is printed: the warehouse shares one login, and
 * whoever prints a batch is the one who picks, packs and dispatches it — so
 * the dashboard can say who sent what.
 */
function WhoPrinting({ people, title, canAdd, onAdd, onPick, onClose }) {
  const [other, setOther] = useState('')
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    const onKey = (e) => { if (/input|textarea|select/i.test(e.target?.tagName || '')) return; const i = parseInt(e.key, 10); if (i >= 1 && i <= people.length) onPick(people[i - 1]) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [people]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Who's printing this?" description={`${title} — they'll pick, pack and dispatch these labels.`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {people.map((n, i) => (
          <button key={n} className={`btn ${n === lastPerson ? 'btn-primary' : 'btn-secondary'} py-4 text-base`} onClick={() => onPick(n)}>
            {n}<span className="text-xs opacity-60 ml-2">{i + 1}</span>
          </button>
        ))}
      </div>
      {!adding ? (
        <button className="link-chip mt-3" onClick={() => setAdding(true)}>Someone else</button>
      ) : (
        <div className="flex gap-2 mt-3">
          <input className="input flex-1" autoFocus placeholder="Their name" value={other} onChange={e => setOther(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && other.trim()) { if (canAdd) onAdd(other.trim()); onPick(other.trim()) } }} />
          <button className="btn btn-primary btn-sm" disabled={!other.trim()} onClick={() => { if (canAdd) onAdd(other.trim()); onPick(other.trim()) }}>
            {canAdd ? 'Add & print' : 'Print'}
          </button>
        </div>
      )}
    </Modal>
  )
}

/** Orders each person dispatched, for each day in the range. */
function PeopleTable({ people, days, onPick }) {
  const shown = [...days].sort().reverse().slice(0, 14)
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 pt-3 pb-1 text-xs font-semibold text-ink/45">Orders dispatched by person</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule">
              <th className="text-left px-4 py-2 text-xs font-semibold text-ink/45">Who</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-ink/45">Orders</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-ink/45">Parcels</th>
              <th className="text-right px-3 py-2 text-xs font-semibold text-ink/45">Units</th>
              {shown.map(d => <th key={d} className="text-right px-3 py-2 text-xs font-semibold text-ink/40 whitespace-nowrap">{dayOf(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {people.map(p => (
              <tr key={p.name} className="border-b border-rule last:border-0 hover:bg-sky/20 cursor-pointer" onClick={() => p.name !== 'Not recorded' && onPick(p.name)}>
                <td className={`px-4 py-2.5 ${p.name === 'Not recorded' ? 'text-ink/45' : 'text-ink font-medium'}`}>{p.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{p.orders}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{p.parcels}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{p.units}</td>
                {shown.map(d => <td key={d} className="px-3 py-2.5 text-right tabular-nums text-ink/70">{p.days[d] || '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-xs text-ink/40">Click a name to see just their orders and products. "Not recorded" is anything printed before names were asked for.</div>
    </div>
  )
}

/** Orders gone each day, as plain bars. */
function DayBars({ days }) {
  const top = Math.max(...days.map(d => d.n), 1)
  return (
    <div className="card">
      <div className="text-xs font-semibold text-ink/45 mb-3">Orders dispatched per day</div>
      <div className="flex items-end gap-1.5 h-28 overflow-x-auto">
        {days.map(d => (
          <div key={d.day} className="flex flex-col items-center justify-end h-full min-w-[30px] flex-1" title={`${dayOf(d.day)}: ${d.n}`}>
            <div className="text-[10px] text-ink/55 tabular-nums mb-0.5">{d.n}</div>
            <div className="w-full bg-royal-500 rounded-t" style={{ height: `${Math.max(4, (d.n / top) * 80)}%` }} />
            <div className="text-[10px] text-ink/40 mt-1 whitespace-nowrap">{dayOf(d.day).replace(/^\w+ /, '')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Checking a label against its slip, by eye ────────────────────────────────

/**
 * The packing slip and its label(s) side by side, with what the portal read
 * from each and what's wrong — so "I've checked it" means something.
 */
function CompareOrder({ loadBytes, labelPages = [], slipPage = null, slip = {}, stamps = [], problems = [], onClose }) {
  const [images, setImages] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const bytes = await loadBytes()
        const imgs = await pagesAsImages(bytes, [slipPage, ...labelPages])
        if (live) setImages(imgs)
      } catch (e) { if (live) setError(e?.message || 'Couldn\'t open the file') }
    })()
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [slipImg, ...labelImgs] = images || []
  return (
    <Modal title="Check the label against the packing slip" maxWidth="max-w-5xl" onClose={onClose}>
      {problems.filter(p => p?.text).map((p, i) => <div key={i} className="text-sm text-loss mb-1">{p.text}</div>)}
      <div className="text-xs text-ink/55 mb-3">
        Make sure the name, postcode and order number match on both, and that the items on the slip are what the stamp will say.
      </div>
      {error ? <WarnBox title="Couldn't show it">{error}</WarnBox> : !images ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold text-ink/45 mb-1.5">Packing slip</div>
            {slipImg ? <img src={slipImg} alt="Packing slip" className="w-full border border-rule rounded" /> : <div className="text-sm text-ink/45">No slip for this label.</div>}
            <div className="text-xs text-ink/65 mt-2 space-y-0.5">
              <div><b>{slip.customer || '—'}</b> · {slip.postcode || '—'} · {slip.ref || 'no reference'}</div>
              <div>{(slip.items || []).map(i => `${i.qty} × ${decode(i.name || i.code)} (${i.code})`).join(' + ') || 'No items read'}</div>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-ink/45 mb-1.5">{labelImgs.length > 1 ? `Labels (${labelImgs.length})` : 'Label'}</div>
            <div className="space-y-3">
              {labelImgs.map((img, i) => (
                <div key={i}>
                  {img ? <img src={img} alt={`Label ${i + 1}`} className="w-full border border-rule rounded" /> : null}
                  {stamps[i] && <div className="text-xs text-ink/65 mt-1">Will be stamped: <b className="text-ink">{stamps[i]}</b></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}


// ── Orders: the day at a glance, by what's stamped on the label ─────────────

const STAGE_STYLE = {
  toPrint:    { bar: 'bg-ink/15', text: 'text-ink/55', tone: 'quiet' },
  printed:    { bar: 'bg-royal-300', text: 'text-royal-600', tone: 'brand' },
  ready:      { bar: 'bg-royal-600', text: 'text-royal-700', tone: 'brand' },
  dispatched: { bar: 'bg-gain', text: 'text-gain', tone: 'live' },
}

/** One bar split by stage, so the day's progress shows at a glance. */
function StageBar({ counts, total, tall }) {
  if (!total) return <div className={`${tall ? 'h-2.5' : 'h-1.5'} rounded-full bg-ink/10`} />
  return (
    <div className={`flex ${tall ? 'h-2.5' : 'h-1.5'} rounded-full overflow-hidden bg-ink/10`}
      aria-label={ORDER_STAGES.map(st => `${counts[st.id]} ${st.label.toLowerCase()}`).join(', ')}>
      {ORDER_STAGES.map(st => counts[st.id] > 0 && (
        <div key={st.id} className={STAGE_STYLE[st.id].bar} style={{ width: `${(counts[st.id] / total) * 100}%` }} />
      ))}
    </div>
  )
}

function DayOrders({ summary, dayLabel }) {
  const { totals, stamps, held } = summary
  const [openStamp, setOpenStamp] = useState(null)
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const found = query ? stamps.flatMap(st => st.list.filter(o => `${o.customer} ${o.postcode} ${o.ref} ${o.batch} ${st.name}`.toLowerCase().includes(query)).map(o => ({ ...o, stamp: st.name }))) : null

  if (!totals.orders) {
    return <div className="surface"><EmptyState icon="printer" title={`No orders uploaded for ${dayLabel}`} sub={held ? `${held} on hold` : 'They show here as soon as a batch is uploaded.'} /></div>
  }
  return (
    <div className="space-y-3">
      {/* The day in five numbers */}
      <div className="card">
        <div className="grid grid-cols-5 gap-1 text-center">
          <Count label="Orders" value={totals.orders} strong />
          {ORDER_STAGES.map(st => <Count key={st.id} label={st.short} value={totals[st.id]} className={totals[st.id] ? STAGE_STYLE[st.id].text : 'text-ink/30'} />)}
        </div>
        <div className="mt-3"><StageBar counts={totals} total={totals.orders} tall /></div>
        <div className="flex justify-between text-[11px] text-ink/45 mt-1.5">
          <span>{Math.round((totals.dispatched / totals.orders) * 100)}% dispatched {dayLabel}</span>
          {held > 0 && <span className="text-loss">{held} on hold</span>}
        </div>
      </div>

      <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Find an order: customer, postcode or ref" className="w-full sm:w-80" />

      {found ? (
        <div className="card p-0 overflow-hidden">
          {found.length === 0 ? <div className="px-4 py-6 text-sm text-ink/55 text-center">No order matches “{q}”.</div>
            : found.slice(0, 50).map(o => <OrderLine key={o.key} o={o} stamp={o.stamp} />)}
        </div>
      ) : (
        <>
          {/* Phones: a card per stamp */}
          <div className="space-y-2 sm:hidden">
            {stamps.map(st => (
              <div key={st.name} className="card p-0 overflow-hidden">
                <button className="w-full text-left px-4 py-3" onClick={() => setOpenStamp(openStamp === st.name ? null : st.name)} aria-expanded={openStamp === st.name}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold text-ink leading-snug">{st.name}</span>
                    <span className="text-lg font-semibold text-ink tabular-nums leading-none">{st.orders}</span>
                  </div>
                  <div className="mt-2"><StageBar counts={st} total={st.orders} /></div>
                  <div className="grid grid-cols-4 gap-1 mt-2 text-center">
                    {ORDER_STAGES.map(x => (
                      <div key={x.id}>
                        <div className={`text-sm font-semibold tabular-nums ${st[x.id] ? STAGE_STYLE[x.id].text : 'text-ink/25'}`}>{st[x.id]}</div>
                        <div className="text-[10px] text-ink/45">{x.short}</div>
                      </div>
                    ))}
                  </div>
                </button>
                {openStamp === st.name && <div className="border-t border-rule">{st.list.map(o => <OrderLine key={o.key} o={o} />)}</div>}
              </div>
            ))}
          </div>

          {/* Wider screens: a table */}
          <div className="card p-0 overflow-hidden hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule bg-paper">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-ink/45">Stamped on the label</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Orders</th>
                    {ORDER_STAGES.map(st => <th key={st.id} className="text-right px-3 py-3 text-xs font-semibold text-ink/45">{st.label}</th>)}
                    <th className="px-4 py-3 w-40"><span className="sr-only">Progress</span></th>
                  </tr>
                </thead>
                <tbody>
                  {stamps.map(st => (
                    <React.Fragment key={st.name}>
                      <tr className="border-b border-rule last:border-0 cursor-pointer hover:bg-sky/20" onClick={() => setOpenStamp(openStamp === st.name ? null : st.name)}>
                        <td className="px-4 py-2.5 text-ink font-medium">
                          <Icon name="chevronRight" size={12} className={`inline mr-1 text-ink/35 transition-transform ${openStamp === st.name ? 'rotate-90' : ''}`} />{st.name}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{st.orders}</td>
                        {ORDER_STAGES.map(x => <td key={x.id} className={`px-3 py-2.5 text-right tabular-nums ${st[x.id] ? STAGE_STYLE[x.id].text : 'text-ink/25'}`}>{st[x.id] || '—'}</td>)}
                        <td className="px-4 py-2.5"><StageBar counts={st} total={st.orders} /></td>
                      </tr>
                      {openStamp === st.name && (
                        <tr className="border-b border-rule bg-paper/50"><td colSpan={7} className="p-0">{st.list.map(o => <OrderLine key={o.key} o={o} />)}</td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <div className="text-xs text-ink/45">Each order counts once, at the stage all its parcels have reached. Updates every 30 seconds.</div>
    </div>
  )
}

function Count({ label, value, strong, className = '' }) {
  return (
    <div>
      <div className={`text-xl sm:text-2xl font-semibold tabular-nums leading-tight ${strong ? 'text-ink' : className}`}>{value}</div>
      <div className="text-[10px] sm:text-[11px] text-ink/50 leading-tight">{label}</div>
    </div>
  )
}

function OrderLine({ o, stamp }) {
  const st = ORDER_STAGES.find(x => x.id === o.stage)
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-rule/70 last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-ink truncate">{o.customer || o.ref || 'Order'}{o.postcode ? <span className="text-ink/50"> · {o.postcode}</span> : ''}</div>
        <div className="text-xs text-ink/45 truncate">{[stamp, o.ref, o.batch, o.parcels > 1 && `${o.parcels} parcels`].filter(Boolean).join(' · ')}</div>
      </div>
      <StatusBadge tone={STAGE_STYLE[o.stage].tone}>{st?.label}</StatusBadge>
    </div>
  )
}
