import React, { useState } from 'react'
import { Icon, SearchInput, EmptyState, Drawer, Modal, StatusBadge, Flag, SegmentedControl, SuggestInput } from './UI'
import { addCare, saveCare } from '../lib/db'
import { smartFilter, hay } from '../lib/match'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { OrderFinder, OrderCard, contentsOf, History, QtyInput, CASE_KINDS, day, when } from './CareParts'
import { REPLACEMENT_STAGES, replacementStage, replacementProblem, sendText, replacementShipDate } from '../lib/careReplacements'

/**
 * Replacement requests (v2.106.0) — the twin of refund requests. The office asks what should be sent again, how many
 * and why; an admin approves or declines; the admin then puts the replacement's label on the request. That label is
 * read and saved as a Dispatch batch marked as a replacement for the order (the same path as Order Audit's
 * "Arrange a replacement"), stamped with the products asked for. Dispatch tells this page when it has gone.
 */
const stageOf = (r, labels) => replacementStage(r, labels)
const longDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
const StageBadge = ({ r, labels }) => { const s = REPLACEMENT_STAGES[stageOf(r, labels)]; return <StatusBadge tone={s?.tone}>{s?.label}</StatusBadge> }

export function ReplacementList({ list, labels, admin, onOpen }) {
  const [view, setView] = useState('requested')
  const [q, setQ] = useState('')
  const inView = (r) => { const s = stageOf(r, labels); return view === 'all' || (view === 'send' ? s === 'approved' || s === 'uploaded' : view === 'sent' ? s === 'dispatched' || s === 'delivered' : s === view) }
  const shown = smartFilter(list.filter(inView), q, r => hay(r.ref, r.order_ref, sendText(r.items), CASE_KINDS[r.reason], r.requested_by, r.note), { keepOrder: true })
  const n = (v) => list.filter(r => { const s = stageOf(r, labels); return v === 'send' ? s === 'approved' || s === 'uploaded' : s === v }).length
  const exportCsv = () => exportRowsToCsv(stampedName('replacements'), shown, [
    { header: 'Replacement', value: r => r.ref }, { header: 'Requested', value: r => r.requested_at?.slice(0, 10) }, { header: 'By', value: r => r.requested_by },
    { header: 'Status', value: r => REPLACEMENT_STAGES[stageOf(r, labels)]?.label }, { header: 'Reason', value: r => CASE_KINDS[r.reason] || r.reason },
    { header: 'To send', value: r => sendText(r.items) }, { header: 'Order', value: r => r.order_ref }, { header: 'Why', value: r => r.note },
    { header: 'Decided by', value: r => r.decided_by || '' }, { header: 'Batch', value: r => r.upload_code || '' },
  ])
  return (
    <>
      <div className="filter-bar">
        <SegmentedControl value={view} onChange={setView} label="Show" items={[
          { id: 'requested', label: `Waiting for approval ${n('requested')}` }, { id: 'send', label: `To send ${n('send')}` },
          { id: 'sent', label: 'Sent' }, { id: 'declined', label: 'Declined' }, { id: 'all', label: 'All' }]} />
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!shown.length}><Icon name="download" size={14} /> Export</button>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Replacement, order, product…" className="w-full sm:w-64 sm:ml-auto" />
      </div>
      {view === 'requested' && n('requested') > 0 && !admin && <div className="text-xs text-ink/55 mb-2">An admin approves or declines these.</div>}
      {!shown.length ? <div className="surface"><EmptyState icon="check" title="Nothing here" /></div> : (
        <div className="card p-0 overflow-hidden" data-replacement-list>{shown.map(r => (
          <button key={r.id} className="w-full text-left px-4 py-3 border-b border-rule last:border-0 hover:bg-paper/70" onClick={() => onOpen(r.id)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm">{r.ref}</span><Flag tone="blue">{CASE_KINDS[r.reason] || r.reason}</Flag></div>
                <div className="text-sm text-ink mt-0.5 break-words">{sendText(r.items)}</div>
                <div className="text-xs text-ink/50 break-words">{[r.order_ref, r.requested_by && `asked by ${r.requested_by}`, day(r.requested_at), r.upload_code && `batch ${r.upload_code}`].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="shrink-0"><StageBadge r={r} labels={labels} /></div>
            </div>
          </button>
        ))}</div>
      )}
    </>
  )
}

/** The office's form: what should be sent again, how many, and why. `from` is the case it is raised from, if any. */
export function RequestReplacement({ me, from, products = [], showToast, onClose, onSaved, initialOrder = null }) {
  const [order, setOrder] = useState(from ? { order_ref: from.order_ref, tracking: from.tracking, carrier: from.carrier, channel: from.channel, parcel_id: from.parcel_id, items: from.ordered?.length ? from.ordered : from.items, contents: from.items } : initialOrder)
  const start = (o, picked) => (picked || (contentsOf(o).length === 1 ? contentsOf(o) : [])).map(i => ({ code: i.code, name: i.name || i.code, qty: Number(i.qty) || 1 }))
  const [items, setItems] = useState(from ? start(null, from.items || []) : start(initialOrder))
  const [reason, setReason] = useState(from?.kind && CASE_KINDS[from.kind] ? from.kind : 'damaged')
  const [extra, setExtra] = useState('')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const contents = order ? contentsOf(order) : []
  const keyOf = (i) => i.code || i.name
  const toggle = (c) => setItems(xs => xs.some(x => keyOf(x) === keyOf(c)) ? xs.filter(x => keyOf(x) !== keyOf(c)) : [...xs, { code: c.code, name: c.name || c.code, qty: Number(c.qty) || 1 }])
  const setQty = (k, n) => setItems(xs => xs.map(x => keyOf(x) === k ? { ...x, qty: n } : x))
  const problem = replacementProblem({ order, items, why })
  return (
    <Modal title="Request a replacement" description="An admin approves or declines it, then adds the label. It goes to Dispatch marked as a replacement." onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3" data-request-replacement>
        {!order ? <OrderFinder onPick={(o) => { setOrder(o); setItems(start(o)) }} />
          : <OrderCard o={order} onChange={from ? null : () => { setOrder(null); setItems([]) }} />}
        {order && (
          <div>
            <div className="label">What should be sent, and how many</div>
            {contents.length > 0 && (
              <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
                {contents.map(c => {
                  const on = items.find(x => keyOf(x) === keyOf(c))
                  return (
                    <div key={keyOf(c)} className="flex items-center gap-2 px-3 py-2">
                      <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={!!on} onChange={() => toggle(c)} aria-label={c.name || c.code} />
                      <span className="flex-1 text-sm text-ink break-words">{c.name || c.code}{Number(c.qty) > 1 && <span className="text-ink/45"> · {c.qty} ordered</span>}</span>
                      {on && <QtyInput value={on.qty} onChange={n => setQty(keyOf(c), n)} aria-label={`How many ${c.name || c.code}`} />}
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-2">
              <SuggestInput value={extra} onChange={setExtra} options={products} placeholder="Or a different product"
                onPick={o => { if (o) { setItems(xs => xs.some(x => x.code === o.code) ? xs : [...xs, { code: o.code, name: o.label, qty: 1 }]); setExtra('') } }} />
              {items.filter(i => !contents.some(c => keyOf(c) === keyOf(i))).map(i => (
                <div key={keyOf(i)} className="flex items-center gap-2 text-sm mt-1.5">
                  <QtyInput value={i.qty} onChange={n => setQty(keyOf(i), n)} aria-label={`How many ${i.name}`} />
                  <span className="flex-1 break-words">{i.name}</span><Flag tone="blue">Not on the order</Flag>
                  <button className="btn btn-ghost btn-xs" onClick={() => setItems(xs => xs.filter(x => keyOf(x) !== keyOf(i)))} aria-label={`Remove ${i.name}`}><Icon name="close" size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div><label className="label" htmlFor="rq-r">Reason</label>
          <select id="rq-r" className="input" value={reason} onChange={e => setReason(e.target.value)}>{Object.entries(CASE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label" htmlFor="rq-w">Why a replacement</label>
          <textarea id="rq-w" className="input min-h-[70px] text-base sm:text-sm" value={why} onChange={e => setWhy(e.target.value)} placeholder="e.g. photos show the jug arrived cracked; the customer wants another, not a refund" /></div>
        <button className="btn btn-primary w-full justify-center" data-request-send disabled={busy || !!problem} onClick={async () => {
          setBusy(true)
          try {
            onSaved(await addCare('replacement_requests', {
              complaint_id: from?.id || null, order_ref: order.order_ref, tracking: order.tracking || null, carrier: order.carrier || null, channel: order.channel || null, parcel_id: order.parcel_id || null,
              items: items.map(i => ({ code: i.code || null, name: i.name, qty: Number(i.qty) || 1 })), ordered: order.items || from?.ordered || [],
              reason, note: why.trim(), requested_by: me?.name || null, status: 'requested',
            }, me?.name))
            showToast?.('Replacement requested — waiting for an admin')
          } catch (e) { showToast?.(`Couldn't save — ${/replacement_requests/.test(e?.message || '') ? 'the database step for replacements has not been applied yet' : e?.message || 'try again'}`, 'error'); setBusy(false) }
        }}>{busy ? 'Saving…' : problem || 'Request it'}</button>
      </div>
    </Modal>
  )
}

export function ReplacementDrawer({ r, labels = [], me, admin, caseRec, showToast, onLog, onClose, onChanged, onCaseChanged, onOpen, onNavigate, onReload }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [up, setUp] = useState(null)        // null | { state: reading | saved | review | error, msg }
  const save = async (patch, what) => { setBusy(true); try { const row = await saveCare('replacement_requests', r, patch, what, me?.name); onChanged(row); return row } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error'); return null } finally { setBusy(false) } }
  const stage = stageOf(r, labels)
  const mine = labels.filter(l => l.request_id === r.id)
  const due = (() => { const d = replacementShipDate(); return { ...d, sunday: new Date(`${d.today}T12:00:00Z`).getUTCDay() === 0 } })()   // which Dispatch day a label added now belongs to
  const decide = async (status) => {
    const row = await save({ status, decided_by: me?.name, decided_at: new Date().toISOString(), decision_note: note.trim() || null }, `${status === 'approved' ? 'Approved' : 'Declined'}${note.trim() ? ` — ${note.trim()}` : ''}`)
    if (row && caseRec) onCaseChanged?.(await saveCare('complaints', caseRec, {}, `Replacement ${r.ref} ${status}`, me?.name).catch(() => caseRec))
  }
  // The label: read and saved by Dispatch's own reader as a new batch, every label a replacement for this order and
  // stamped with what was asked for. Nothing about Dispatch is different for it.
  const upload = async () => {
    setUp({ state: 'reading', msg: 'Reading the label…' })
    const { startJob, subscribeJobs } = await import('../lib/dispatchJobs')
    const items = (r.items || []).map(i => ({ code: i.code, name: i.name, qty: Number(i.qty) || 1 }))
    // v2.108.0 (the owner): from 5pm it belongs to the next working day (Monday to Saturday), not today
    const ship = replacementShipDate()
    const id = startJob(file, { title: `Replacement ${r.ref} for ${r.order_ref}`, me, onLog, shipDate: ship.date, manualAll: { items, note: `Replacement ${r.ref} for ${r.order_ref}${r.note ? ` — ${r.note}` : ''}`.slice(0, 240), originalRef: r.order_ref } })
    const stop = subscribeJobs(async jobs => {
      const j = jobs.find(x => x.id === id)
      if (!j) return
      if (j.status === 'saved') {
        stop?.()
        const u = j.result?.upload || {}
        const forDay = ship.moved ? ` for ${longDay(ship.date)}` : ''
        setUp({ state: 'saved', msg: ship.moved ? `Saved as batch ${u.code || ''} — it is in Dispatch for ${longDay(ship.date)}` : `Saved as batch ${u.code || ''} — it is in Dispatch, ready to print` })
        await save({ upload_id: u.id || null, upload_code: u.code || null, label_uploaded_at: new Date().toISOString(), label_uploaded_by: me?.name || null }, `Replacement label uploaded — batch ${u.code || '?'}${forDay}`)
        if (caseRec) onCaseChanged?.(await saveCare('complaints', caseRec, caseRec.replacement_ref ? {} : { replacement_ref: r.ref }, `Replacement ${r.ref}: label uploaded — batch ${u.code || '?'}${forDay}`, me?.name).catch(() => caseRec))
        onReload?.()
      } else if (j.status === 'review') { stop?.(); setUp({ state: 'review', msg: 'Almost — it needs a quick look in Dispatch (for example which carrier) before it saves. Finish it there; it will show here once saved.' }) }
      else if (j.status === 'error') { stop?.(); setUp({ state: 'error', msg: j.error || 'Couldn’t read that file' }) }
    })
  }
  return (
    <Drawer title={r.ref} onClose={onClose} description={`Replacement · ${CASE_KINDS[r.reason] || r.reason} · ${r.order_ref || ''}`}>
      <div className="space-y-4" data-replacement-drawer>
        <div className="card space-y-2">
          <div className="flex items-center justify-between gap-2"><StageBadge r={r} labels={labels} /><span className="text-xs text-ink/50">{String(r.channel || '')}</span></div>
          <div><div className="text-xs text-ink/45">To send</div>
            <ul className="text-sm text-ink">{(r.items || []).map((i, k) => <li key={k} className="break-words"><b className="tabular-nums">{i.qty} ×</b> {i.name || i.code}</li>)}</ul></div>
          {(r.ordered || []).length > 0 && <div className="text-xs text-ink/55 break-words">Ordered: {sendText(r.ordered)}</div>}
          <div className="border-t border-rule pt-2 text-sm">
            <div className="text-xs text-ink/45">{r.requested_by || 'Someone'} asked on {day(r.requested_at)}</div>
            {r.note && <div className="text-ink/80 mt-0.5 whitespace-pre-wrap break-words">{r.note}</div>}
          </div>
          <div className="flex gap-3 flex-wrap">
            {caseRec && <button className="text-xs text-royal-600 hover:underline" onClick={() => onOpen('complaints', caseRec.id)}>Case {caseRec.ref} →</button>}
            {r.order_ref && onNavigate && <button className="text-xs text-royal-600 hover:underline" onClick={() => onNavigate('order-audit', r.order_ref)}>Order audit →</button>}
          </div>
        </div>

        {stage === 'requested' && (admin ? (
          <div className="card space-y-2">
            <div className="section-title">Approve or decline</div>
            <input className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" />
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" data-replacement-approve disabled={busy} onClick={() => decide('approved')}><Icon name="check" size={13} /> Approve</button>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => decide('declined')}>Decline</button>
            </div>
          </div>
        ) : <div className="card text-sm text-ink/60">Waiting for an admin to approve or decline it.</div>)}

        {stage === 'declined' && <div className="card text-sm"><Flag tone="grey">Declined by {r.decided_by} {when(r.decided_at)}</Flag>{r.decision_note && <div className="text-ink/70 mt-1 break-words">{r.decision_note}</div>}</div>}

        {(stage === 'approved' || (stage === 'uploaded' && !mine.length)) && (admin ? (
          <div className="card space-y-2.5" data-replacement-upload>
            <div className="section-title">The replacement’s label</div>
            <div className="text-xs text-ink/55">Approved by {r.decided_by} {when(r.decided_at)}. Make the label, then add it here: it goes to Dispatch as its own batch, marked as a replacement for {r.order_ref} and stamped with the products above.</div>
            {up?.state !== 'saved' && (
              <label className={`flex items-center gap-3 border-2 border-dashed rounded-[8px] px-4 py-3 cursor-pointer ${file ? 'border-royal-300 bg-sky/30' : 'border-rule hover:border-royal-300'}`}>
                <Icon name="upload" size={18} />
                <span className="text-sm break-all">{file ? file.name : 'Choose the label PDF'}</span>
                <input type="file" accept="application/pdf,image/*" className="hidden" data-replacement-file onChange={e => { setFile(e.target.files?.[0] || null); setUp(null) }} />
              </label>
            )}
            {up?.state !== 'saved' && due.moved && <div className="text-xs text-royal-700" data-replacement-day>It is {due.sunday ? 'Sunday' : 'after 5pm'}, so this will be in Dispatch for <b>{longDay(due.date)}</b>.</div>}
            {up?.msg && <div className={`text-sm ${up.state === 'error' ? 'text-loss' : up.state === 'saved' ? 'text-gain font-semibold' : 'text-ink/70'}`} role="status">{up.msg}</div>}
            {up?.state !== 'saved' && up?.state !== 'review' && (
              <button className="btn btn-primary btn-sm" disabled={!file || up?.state === 'reading' || busy} onClick={upload}>{up?.state === 'reading' ? 'Reading the label…' : 'Upload the label'}</button>
            )}
            {(up?.state === 'saved' || up?.state === 'review') && onNavigate && <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('dispatch')}>Open Dispatch</button>}
          </div>
        ) : <div className="card text-sm text-ink/60">Approved by {r.decided_by} {when(r.decided_at)}. Waiting for an admin to add the label.</div>)}

        {mine.length > 0 && (
          <div className="card space-y-2" data-replacement-labels>
            <div className="section-title">In Dispatch</div>
            {mine.map(l => (
              <div key={l.id} className="border-t border-rule/70 first:border-0 pt-2 first:pt-0 text-sm">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-medium text-ink">Batch {l.code || '—'} #{l.seq}</span>
                  <StatusBadge tone={l.delivered_at ? 'live' : l.status === 'dispatched' ? 'live' : 'info'}>{l.delivered_at ? 'Delivered' : l.status === 'dispatched' ? 'Dispatched' : l.printed_at ? 'Printed — to dispatch' : 'To print'}</StatusBadge>
                </div>
                <div className="text-xs text-ink/55 break-words">{[l.label_name, l.tracking && `tracking ${l.tracking}`].filter(Boolean).join(' · ')}</div>
                <div className="text-xs text-ink/45">{[`uploaded ${when(l.created_at)}`, l.dispatched_at && `dispatched ${when(l.dispatched_at)}${l.dispatched_by_name ? ` by ${l.dispatched_by_name}` : ''}`, l.delivered_at && `delivered ${day(l.delivered_at)}`].filter(Boolean).join(' · ')}</div>
                {l.tracking_url && <a className="text-xs text-royal-600 hover:underline" href={l.tracking_url} target="_blank" rel="noreferrer">Track it</a>}
              </div>
            ))}
          </div>
        )}
        <History list={r.history} />
      </div>
    </Drawer>
  )
}
