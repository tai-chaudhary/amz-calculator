import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { PageHeader, Icon, SearchInput, EmptyState, Drawer, Modal, Spinner, MetricCard, StatusBadge, Flag, SegmentedControl, Tabs } from './UI'
import { loadCare, addCare, saveCare, uploadCarePhotos, addClaim, loadClaims } from '../lib/db'
import { smartFilter, hay } from '../lib/match'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { OrderFinder, OrderCard, ItemsPicker, contentsOf, startPicked, PhotoPicker, Photos, History, CASE_KINDS, CAUSE, RETURN_REASONS, CONDITIONS, day, when, itemsText, money } from './CareParts'
import { RETURN_STATUS } from './ReturnsPage'
import { takePrefill } from './OrderAuditPage'

/**
 * Cases & Refunds (office and Jignesh, Oct 2026), built around how a problem plays out:
 *   damaged → photos → replacement or refund (part / full) → claim with the carrier → ask for it back
 *   wrong item → replacement, or full refund if refused → a packing error against whoever packed it → ask for it back
 *   not received → check tracking → POD if delivered, else replacement / refund → lost claim
 *   not happy → talk it through → refund if it comes to it → ask for it back
 *   refused delivery → comes back from the carrier → full refund
 * A case is the customer's complaint, against some or all of the order's products. A refund request carries the
 * reason, a recommendation, none / part / full and the amount; only an admin approves or declines it, and it's
 * paid once it's been refunded on the marketplace. Returns are logged by the warehouse (Returns page).
 */
const REFUND_REASONS = { damaged: 'Damaged', wrong_item: 'Wrong item', missing_item: 'Missing item', not_received: 'Not received', not_happy: 'Not happy', refused: 'Refused delivery', other: 'Other' }
const REFUND_STATUS = { requested: { label: 'Waiting for approval', tone: 'warn' }, approved: { label: 'Approved — to refund', tone: 'info' }, declined: { label: 'Declined', tone: 'quiet' }, paid: { label: 'Refunded', tone: 'live' } }
const CASE_STATUS = { open: { label: 'Open', tone: 'alert' }, waiting: { label: 'Waiting on customer', tone: 'warn' }, resolved: { label: 'Resolved', tone: 'live' } }
const CLAIM_WORD = { to_raise: 'Claim to raise', raised: 'Claim raised — waiting', accepted: 'Claim won', rejected: 'Claim lost', closed: 'Claim closed', not_needed: 'No claim needed' }

export default function CustomerCarePage({ me, showToast, inventory, onNavigate }) {
  const [data, setData] = useState(null)
  const [claims, setClaims] = useState([])
  const [tab, setTab] = useState('cases')
  const [open, setOpen] = useState(null)        // { table, id }
  const [adding, setAdding] = useState(null)    // 'case' | { refundFor: case }
  const admin = me?.role === 'admin'
  const load = useCallback(async () => {
    try { setData(await loadCare()) } catch (e) { showToast?.(`Couldn't load — ${e?.message || 'try again'}`, 'error'); setData({ complaints: [], returns: [], refunds: [] }) }
    loadClaims().then(setClaims).catch(() => setClaims([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  // Sent from Order Audit: open the form with the order already filled in
  useEffect(() => {
    const p = takePrefill(['case', 'refund'])
    if (!p) return
    if (p.kind === 'case') setAdding({ caseOrder: p.order })
    else setAdding({ refundFor: null, order: p.order })
  }, [])
  const put = (table, row) => setData(d => ({ ...d, [table]: d[table].some(x => x.id === row.id) ? d[table].map(x => x.id === row.id ? row : x) : [row, ...d[table]] }))
  const claimFor = (rec) => claims.find(c => (rec.claim_id && c.id === rec.claim_id) || (rec.parcel_id && c.parcel_id === rec.parcel_id) || (rec.order_ref && c.order_ref === rec.order_ref))
  const rec = open && data?.[open.table]?.find(x => x.id === open.id)
  const counts = data ? {
    cases: data.complaints.filter(c => c.status !== 'resolved').length,
    refunds: data.refunds.filter(r => r.status === 'requested' || r.status === 'approved').length,
    returns: data.returns.filter(r => r.status === 'expected' || r.status === 'received').length,
  } : {}
  return (
    <div>
      <PageHeader eyebrow="Customers / care" title="Cases & Refunds"
        description="Customer complaints, what was done about them, refunds and what's come back — each tied to its order, products, carrier and who packed it."
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding({ refundFor: null })}><Icon name="pound" size={14} /> Request a refund</button>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding('case')}><Icon name="plus" size={14} /> Log a case</button>
        </>} />
      {!data ? <Spinner /> : (
        <>
          <Tabs value={tab} onChange={setTab} items={[
            { id: 'cases', label: 'Cases', count: counts.cases || null }, { id: 'refunds', label: 'Refunds', count: counts.refunds || null },
            { id: 'returns', label: 'Returns', count: counts.returns || null }, { id: 'dashboard', label: 'Dashboard' },
          ]} />
          <div className="mt-4">
            {tab === 'cases' && <CaseList list={data.complaints} refunds={data.refunds} onOpen={(id) => setOpen({ table: 'complaints', id })} />}
            {tab === 'refunds' && <RefundList list={data.refunds} admin={admin} claimFor={claimFor} onOpen={(id) => setOpen({ table: 'refunds', id })} />}
            {tab === 'returns' && <ReturnList list={data.returns} onNavigate={onNavigate} />}
            {tab === 'dashboard' && <Dashboard data={data} inventory={inventory} />}
          </div>
        </>
      )}
      {(adding === 'case' || adding?.caseOrder) && <LogCase me={me} initialOrder={adding?.caseOrder || null} showToast={showToast} onClose={() => setAdding(null)} onSaved={(row) => { put('complaints', row); setAdding(null); setTab('cases'); setOpen({ table: 'complaints', id: row.id }) }} />}
      {adding && adding !== 'case' && !adding.caseOrder && <RequestRefund me={me} showToast={showToast} from={adding.refundFor} initialOrder={adding.order || null} onClose={() => setAdding(null)}
        onSaved={async (row) => {
          put('refunds', row); setAdding(null); setTab('refunds'); setOpen({ table: 'refunds', id: row.id })
          if (adding.refundFor) put('complaints', await saveCare('complaints', adding.refundFor, {}, `Refund ${row.ref} requested (${row.kind === 'full' ? 'full' : row.kind === 'partial' ? 'part' : 'none'}${row.amount ? `, ${money(row.amount)}` : ''})`, me?.name))
        }} />}
      {rec && open.table === 'complaints' && <CaseDrawer c={rec} me={me} data={data} claim={claimFor(rec)} showToast={showToast} onClose={() => setOpen(null)}
        onChanged={(r) => put('complaints', r)} onPut={put} onRefund={() => setAdding({ refundFor: rec })} onOpen={(table, id) => setOpen({ table, id })} onNavigate={onNavigate} />}
      {rec && open.table === 'refunds' && <RefundDrawer r={rec} me={me} admin={admin} claim={claimFor(rec)} caseRec={data.complaints.find(c => c.id === rec.complaint_id)} showToast={showToast}
        onClose={() => setOpen(null)} onChanged={(r) => put('refunds', r)} onOpen={(table, id) => setOpen({ table, id })} onNavigate={onNavigate} />}
    </div>
  )
}

// ── Lists ────────────────────────────────────────────────────────────────────
function CaseList({ list, refunds, onOpen }) {
  const [view, setView] = useState('open')
  const [q, setQ] = useState('')
  const shown = smartFilter(list.filter(c => view === 'all' || (view === 'open' ? c.status !== 'resolved' : c.status === 'resolved')), q,
    c => hay(c.ref, c.order_ref, c.tracking, itemsText(c.items), c.product_name, CASE_KINDS[c.kind], c.carrier, c.packer, c.details), { keepOrder: true })
  const exportCsv = () => exportRowsToCsv(stampedName('cases'), shown, [
    { header: 'Case', value: c => c.ref }, { header: 'Logged', value: c => c.created_at?.slice(0, 10) }, { header: 'Status', value: c => CASE_STATUS[c.status]?.label || c.status },
    { header: 'Type', value: c => CASE_KINDS[c.kind] || c.kind }, { header: 'Products', value: c => itemsText(c.items) || c.product_name }, { header: 'Order', value: c => c.order_ref },
    { header: 'Carrier', value: c => c.carrier }, { header: 'Label', value: c => (c.batch_code ? `${c.batch_code} #${c.label_seq}` : '') }, { header: 'Packed by', value: c => c.packer },
    { header: 'Details', value: c => c.details },
  ])
  return (
    <>
      <div className="filter-bar">
        <SegmentedControl value={view} onChange={setView} label="Show" items={[{ id: 'open', label: `Open ${list.filter(c => c.status !== 'resolved').length}` }, { id: 'resolved', label: 'Resolved' }, { id: 'all', label: 'All' }]} />
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!shown.length}><Icon name="download" size={14} /> Export</button>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Case, order, product, carrier…" className="w-full sm:w-72 sm:ml-auto" />
      </div>
      {!shown.length ? <div className="surface"><EmptyState icon="check" title="No cases here" sub="Log one from the customer's order reference." /></div> : (
        <div className="card p-0 overflow-hidden">{shown.map(c => {
          const age = Math.floor((Date.now() - Date.parse(c.created_at)) / 864e5)
          const rf = refunds.filter(r => r.complaint_id === c.id)
          return (
            <button key={c.id} className="w-full text-left px-4 py-3 border-b border-rule last:border-0 hover:bg-paper/70" onClick={() => onOpen(c.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{c.ref}</span>
                    <Flag tone={CAUSE[c.kind] === 'packing' ? 'red' : CAUSE[c.kind] === 'carrier' ? 'amber' : 'blue'}>{CASE_KINDS[c.kind] || c.kind}</Flag>
                    {rf.map(r => <Flag key={r.id} tone={r.status === 'paid' ? 'green' : 'amber'} icon="pound">{r.ref}</Flag>)}
                    {c.status !== 'resolved' && age >= 3 && <Flag tone="red" icon="clock">{age} days open</Flag>}
                  </div>
                  <div className="text-sm text-ink mt-0.5 truncate">{itemsText(c.items) || c.product_name || 'Products not set'}</div>
                  <div className="text-xs text-ink/50">{[c.order_ref, String(c.carrier || '').split(' ')[0], c.packer && `packed by ${c.packer}`, day(c.created_at)].filter(Boolean).join(' · ')}</div>
                </div>
                <StatusBadge tone={CASE_STATUS[c.status]?.tone || 'alert'}>{CASE_STATUS[c.status]?.label || c.status}</StatusBadge>
              </div>
            </button>
          )
        })}</div>
      )}
    </>
  )
}

function RefundList({ list, admin, claimFor, onOpen }) {
  const [view, setView] = useState('requested')
  const [q, setQ] = useState('')
  const shown = smartFilter(list.filter(r => view === 'all' || r.status === view), q, r => hay(r.ref, r.order_ref, itemsText(r.items), REFUND_REASONS[r.reason], r.requested_by), { keepOrder: true })
  const exportCsv = () => exportRowsToCsv(stampedName('refunds'), shown, [
    { header: 'Refund', value: r => r.ref }, { header: 'Requested', value: r => r.requested_at?.slice(0, 10) }, { header: 'By', value: r => r.requested_by },
    { header: 'Status', value: r => REFUND_STATUS[r.status]?.label }, { header: 'Reason', value: r => REFUND_REASONS[r.reason] }, { header: 'Type', value: r => r.kind },
    { header: 'Amount £', value: r => r.amount ?? '' }, { header: 'Refunded £', value: r => r.paid_amount ?? '' }, { header: 'Refunded on', value: r => r.paid_at?.slice(0, 10) || '' },
    { header: 'Order', value: r => r.order_ref }, { header: 'Carrier', value: r => r.carrier }, { header: 'Recommendation', value: r => (r.recommendation === 'give' ? 'Give it' : r.recommendation === 'dont_give' ? 'Don’t give it' : '') },
  ])
  const n = (s) => list.filter(r => r.status === s).length
  return (
    <>
      <div className="filter-bar">
        <SegmentedControl value={view} onChange={setView} label="Show" items={[
          { id: 'requested', label: `Waiting for approval ${n('requested')}` }, { id: 'approved', label: `To refund ${n('approved')}` },
          { id: 'paid', label: 'Refunded' }, { id: 'declined', label: 'Declined' }, { id: 'all', label: 'All' }]} />
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!shown.length}><Icon name="download" size={14} /> Export</button>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Refund, order, product…" className="w-full sm:w-64 sm:ml-auto" />
      </div>
      {view === 'requested' && n('requested') > 0 && !admin && <div className="text-xs text-ink/55 mb-2">An admin approves or declines these.</div>}
      {!shown.length ? <div className="surface"><EmptyState icon="check" title="Nothing here" /></div> : (
        <div className="card p-0 overflow-hidden">{shown.map(r => {
          const cl = claimFor(r)
          return (
            <button key={r.id} className="w-full text-left px-4 py-3 border-b border-rule last:border-0 hover:bg-paper/70" onClick={() => onOpen(r.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{r.ref}</span><Flag tone="blue">{REFUND_REASONS[r.reason]}</Flag>
                    {r.recommendation && <Flag tone={r.recommendation === 'give' ? 'green' : 'red'}>{r.recommendation === 'give' ? 'Recommends giving it' : 'Recommends not'}</Flag>}
                    {cl && <Flag tone={cl.status === 'accepted' ? 'green' : cl.status === 'rejected' ? 'red' : 'amber'} icon="receipt">{CLAIM_WORD[cl.status] || 'Claim'}</Flag>}
                  </div>
                  <div className="text-sm text-ink mt-0.5 truncate">{itemsText(r.items) || r.order_ref}</div>
                  <div className="text-xs text-ink/50">{[r.order_ref, String(r.carrier || '').split(' ')[0], r.requested_by && `asked by ${r.requested_by}`, day(r.requested_at)].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusBadge tone={REFUND_STATUS[r.status]?.tone}>{REFUND_STATUS[r.status]?.label}</StatusBadge>
                  <span className="text-sm font-semibold tabular-nums">{r.status === 'paid' ? money(r.paid_amount) : r.kind === 'none' ? 'No refund' : money(r.amount)}<span className="text-[10px] text-ink/45 font-normal"> {r.kind === 'partial' ? 'part' : r.kind === 'full' ? 'full' : ''}</span></span>
                </div>
              </div>
            </button>
          )
        })}</div>
      )}
    </>
  )
}

function ReturnList({ list, onNavigate }) {
  const [view, setView] = useState('outstanding')
  const shown = list.filter(r => view === 'all' || (view === 'outstanding' ? ['expected', 'received'].includes(r.status) : !['expected', 'received'].includes(r.status)))
  return (
    <>
      <div className="filter-bar">
        <SegmentedControl value={view} onChange={setView} label="Show" items={[{ id: 'outstanding', label: `Outstanding ${list.filter(r => ['expected', 'received'].includes(r.status)).length}` }, { id: 'done', label: 'Done' }, { id: 'all', label: 'All' }]} />
        <button className="btn btn-secondary btn-sm sm:ml-auto" onClick={() => onNavigate?.('returns')}><Icon name="inbox" size={14} /> Open Returns (warehouse)</button>
      </div>
      {!shown.length ? <div className="surface"><EmptyState icon="inbox" title="No returns here" sub="The warehouse logs returns as they arrive." /></div> : (
        <div className="card p-0 overflow-hidden">{shown.map(r => (
          <div key={r.id} className="px-4 py-3 border-b border-rule last:border-0 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm">{r.ref}</span><span className="text-xs text-ink/55">{RETURN_REASONS[r.reason] || r.reason}</span>
                {r.condition && <Flag tone={r.condition === 'resaleable' ? 'green' : 'red'}>{CONDITIONS[r.condition]}</Flag>}</div>
              <div className="text-sm text-ink truncate">{itemsText(r.items)}</div>
              <div className="text-xs text-ink/50">{[r.order_ref || r.from_name, r.tracking, day(r.received_at || r.created_at), (r.photos || []).length && `${r.photos.length} photos`].filter(Boolean).join(' · ')}</div>
            </div>
            <StatusBadge tone={RETURN_STATUS[r.status]?.tone}>{RETURN_STATUS[r.status]?.label}</StatusBadge>
          </div>
        ))}</div>
      )}
    </>
  )
}

// ── Logging ──────────────────────────────────────────────────────────────────
const itemsOf = (o) => startPicked(o)
function LogCase({ me, showToast, onClose, onSaved, initialOrder = null }) {
  const [order, setOrder] = useState(initialOrder)
  const [items, setItems] = useState(itemsOf(initialOrder))
  const [kind, setKind] = useState('damaged')
  const [details, setDetails] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Log a case" description="Find the order — its products, carrier, label and who packed it fill in." onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {!order ? <OrderFinder onPick={(o) => { setOrder(o); setItems(startPicked(o)) }} />
          : <OrderCard o={order} onChange={() => { setOrder(null); setItems([]) }} />}
        {order && <ItemsPicker items={contentsOf(order)} ordered={order.items} value={items} onChange={setItems} />}
        <div><div className="label">What happened</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{Object.entries(CASE_KINDS).map(([k, v]) => <button key={k} type="button" className={`btn btn-sm justify-center ${kind === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind(k)}>{v}</button>)}</div></div>
        {kind === 'not_received' && order?.parcel_status === 7 && <Flag tone="amber" icon="info">Tracking says it was delivered {day(order.delivered_at)} — send the customer the proof of delivery</Flag>}
        <div><label className="label" htmlFor="cs-d">Details</label>
          <textarea id="cs-d" className="input min-h-[80px] text-base sm:text-sm" value={details} onChange={e => setDetails(e.target.value)} placeholder="What the customer said" /></div>
        <PhotoPicker files={files} onChange={setFiles} label="Photos from the customer (optional)" />
        <button className="btn btn-primary w-full justify-center" disabled={busy || !order || !items.length} onClick={async () => {
          setBusy(true)
          try {
            let row = await addCare('complaints', {
              order_ref: order.order_ref, tracking: order.tracking, carrier: order.carrier, channel: order.channel, parcel_id: order.parcel_id,
              label_id: order.label_id, batch_code: order.batch_code, label_seq: order.seq, packer: order.packer, shipped_at: order.shipped_at,
              items: items.map(({ key, ...i }) => i), ordered: order.items || [], product_name: items.map(i => i.name).join(', ').slice(0, 300), qty: items.reduce((t, i) => t + i.qty, 0),
              kind, details: details.trim() || null, order_total: order.order_total ?? null, status: 'open',
            }, me?.name)
            if (files.length) row = await saveCare('complaints', row, { photos: await uploadCarePhotos(row.id, files) }, `${files.length} photo${files.length === 1 ? '' : 's'} added`, me?.name)
            showToast?.(`${row.ref} logged`)
            onSaved(row)
          } catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
        }}>{!order ? 'Find the order first' : !items.length ? 'Pick the products' : busy ? 'Saving…' : 'Log the case'}</button>
      </div>
    </Modal>
  )
}

function RequestRefund({ me, from, showToast, onClose, onSaved, initialOrder = null }) {
  const [order, setOrder] = useState(from ? { order_ref: from.order_ref, tracking: from.tracking, carrier: from.carrier, channel: from.channel, parcel_id: from.parcel_id, items: from.ordered?.length ? from.ordered : from.items, contents: from.items, order_total: from.order_total } : initialOrder)
  const [items, setItems] = useState(from ? (from.items || []).map((i, k) => ({ key: `${k}|${i.code || i.name}`, ...i })) : itemsOf(initialOrder))
  const [reason, setReason] = useState(from?.kind && REFUND_REASONS[from.kind] ? from.kind : 'damaged')
  const [kind, setKind] = useState('full')
  const [amount, setAmount] = useState(from?.order_total ?? initialOrder?.order_total ?? '')
  const [rec, setRec] = useState('give')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = order && reason && rec && why.trim() && (kind === 'none' || Number(amount) > 0)
  return (
    <Modal title="Request a refund" description="An admin approves or declines it. It's marked refunded once it's been done on the marketplace." onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {!order ? <OrderFinder onPick={(o) => { setOrder(o); setItems(startPicked(o)); if (o.order_total) setAmount(o.order_total) }} />
          : <OrderCard o={order} onChange={from ? null : () => setOrder(null)} />}
        {order && contentsOf(order).length > 0 && <ItemsPicker items={contentsOf(order)} ordered={order.items} value={items} onChange={setItems} />}
        <div><label className="label" htmlFor="rf-r">Reason</label>
          <select id="rf-r" className="input" value={reason} onChange={e => setReason(e.target.value)}>{Object.entries(REFUND_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><div className="label">Refund</div>
          <div className="grid grid-cols-3 gap-2">{[['full', 'Full'], ['partial', 'Part'], ['none', 'None']].map(([k, v]) => <button key={k} type="button" className={`btn btn-sm justify-center ${kind === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setKind(k)}>{v}</button>)}</div></div>
        {kind !== 'none' && (
          <div><label className="label" htmlFor="rf-a">Amount £</label>
            <input id="rf-a" type="number" step="0.01" className="input w-40 text-base sm:text-sm" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            {order?.order_total ? <div className="text-[11px] text-ink/45 mt-1">The customer paid {money(order.order_total)}</div> : <div className="text-[11px] text-ink/45 mt-1">Check what the customer paid on the marketplace</div>}</div>
        )}
        <div><div className="label">Your recommendation</div>
          <div className="grid grid-cols-2 gap-2">{[['give', 'Give it'], ['dont_give', 'Don’t give it']].map(([k, v]) => <button key={k} type="button" className={`btn btn-sm justify-center ${rec === k ? (k === 'give' ? 'btn-primary' : 'btn-danger') : 'btn-secondary'}`} onClick={() => setRec(k)}>{v}</button>)}</div></div>
        <div><label className="label" htmlFor="rf-w">Why</label>
          <textarea id="rf-w" className="input min-h-[70px] text-base sm:text-sm" value={why} onChange={e => setWhy(e.target.value)} placeholder="e.g. photos show the jug arrived cracked; customer refused a replacement" /></div>
        <button className="btn btn-primary w-full justify-center" disabled={busy || !ok} onClick={async () => {
          setBusy(true)
          try {
            onSaved(await addCare('refunds', {
              complaint_id: from?.id || null, order_ref: order.order_ref, tracking: order.tracking, carrier: order.carrier, channel: order.channel, parcel_id: order.parcel_id || null,
              items: items.map(({ key, ...i }) => i), ordered: order.items || from?.ordered || [], reason, kind, amount: kind === 'none' ? 0 : Number(amount), order_total: order.order_total ?? null,
              recommendation: rec, recommendation_note: why.trim(), requested_by: me?.name || null, status: 'requested',
            }, me?.name))
            showToast?.('Refund requested — waiting for an admin')
          } catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
        }}>{busy ? 'Saving…' : 'Request it'}</button>
      </div>
    </Modal>
  )
}

// ── Drawers ──────────────────────────────────────────────────────────────────
function ClaimLink({ claim, canRaise, onRaise, onNavigate }) {
  if (claim) return (
    <button className="w-full text-left card flex items-center justify-between gap-2 hover:bg-paper" onClick={() => onNavigate?.('claims', claim.id)}>
      <div><div className="text-sm font-semibold text-ink">Carrier claim {claim.ref}</div><div className="text-xs text-ink/55">{CLAIM_WORD[claim.status] || claim.status}{claim.outcome_amount ? ` · ${money(claim.outcome_amount)}` : ''}</div></div>
      <span className="text-xs text-royal-600 font-semibold">Open the claim →</span>
    </button>
  )
  return canRaise ? <button className="btn btn-secondary btn-sm" onClick={onRaise}><Icon name="receipt" size={13} /> Raise a carrier claim</button> : null
}

function CaseDrawer({ c, me, data, claim, showToast, onClose, onChanged, onPut, onRefund, onOpen, onNavigate }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [rep, setRep] = useState(c.replacement_ref || '')
  const save = async (patch, what) => { setBusy(true); try { onChanged(await saveCare('complaints', c, patch, what, me?.name)) } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error') } finally { setBusy(false) } }
  const refunds = data.refunds.filter(r => r.complaint_id === c.id)
  const returns = data.returns.filter(r => r.complaint_id === c.id || (c.return_id && r.id === c.return_id))
  const claimable = ['damaged', 'missing_item', 'not_received'].includes(c.kind) && c.parcel_id
  return (
    <Drawer title={c.ref} onClose={onClose} description={`${CASE_KINDS[c.kind] || c.kind} · ${c.order_ref || ''}`}>
      <div className="space-y-4">
        <div className="card space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <SegmentedControl value={c.status} onChange={v => save({ status: v, resolved_at: v === 'resolved' ? new Date().toISOString() : null }, CASE_STATUS[v].label)} label="Status"
              items={Object.entries(CASE_STATUS).map(([k, v]) => ({ id: k, label: v.label }))} />
          </div>
          <div className="text-sm text-ink"><span className="text-xs text-ink/45">Affected: </span>{itemsText(c.items) || c.product_name}</div>
          {(c.ordered || []).length > 0 && <div className="text-xs text-ink/55">Ordered: {itemsText(c.ordered)}</div>}
          <div className="text-xs text-ink/55">{[String(c.carrier || '').split(' ')[0], c.batch_code && `${c.batch_code} #${c.label_seq}`, c.packer && `packed by ${c.packer}`, c.shipped_at && `sent ${day(c.shipped_at)}`].filter(Boolean).join(' · ')}</div>
          {CAUSE[c.kind] === 'packing' && <Flag tone="red" icon="alert">Counts as a packing error{c.packer ? ` for ${c.packer}` : ''}</Flag>}
          {c.details && <div className="text-sm text-ink/80 whitespace-pre-wrap border-t border-rule pt-2">{c.details}</div>}
        </div>

        <div className="card space-y-2.5">
          <div className="section-title">What we did</div>
          {c.kind === 'not_received' && (
            c.pod_sent_at ? <Flag tone="green" icon="check">Proof of delivery sent {day(c.pod_sent_at)}</Flag>
              : <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save({ pod_sent_at: new Date().toISOString(), status: 'waiting' }, 'Proof of delivery sent to the customer')}>Sent the proof of delivery</button>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <input className="input flex-1 min-w-[160px] text-base sm:text-sm" value={rep} onChange={e => setRep(e.target.value)} placeholder="Replacement order ref" />
            <button className="btn btn-secondary btn-sm" disabled={busy || !rep.trim() || rep.trim() === c.replacement_ref} onClick={() => save({ replacement_ref: rep.trim() }, `Replacement sent — ${rep.trim()}`)}>Replacement sent</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-secondary btn-sm" onClick={onRefund}><Icon name="pound" size={13} /> Request a refund</button>
            <button className="btn btn-secondary btn-sm" disabled={busy || returns.some(r => r.status === 'expected')} onClick={async () => {
              setBusy(true)
              try {
                const r = await addCare('returns', { complaint_id: c.id, source: 'customer', reason: c.kind === 'wrong_item' ? 'wrong_item' : c.kind === 'damaged' ? 'damaged' : 'not_happy',
                  order_ref: c.order_ref, tracking: c.tracking, carrier: c.carrier, channel: c.channel, items: c.items || [], status: 'expected' }, me?.name)
                onPut('returns', r); onChanged(await saveCare('complaints', c, { return_id: r.id }, `Asked for it back — ${r.ref} expected`, me?.name))
                showToast?.(`${r.ref}: the warehouse will log it when it arrives`)
              } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error') } finally { setBusy(false) }
            }}><Icon name="inbox" size={13} /> Ask for it back</button>
          </div>
          <ClaimLink claim={claim} canRaise={claimable} onNavigate={onNavigate} onRaise={async () => {
            setBusy(true)
            try {
              const cl = await addClaim({ parcel_id: c.parcel_id, order_ref: c.order_ref, tracking: c.tracking, carrier: c.carrier, channel: c.channel, items: c.items || [],
                reason: c.kind === 'not_received' ? 'lost' : c.kind === 'damaged' ? 'damaged' : 'other', notes: `From case ${c.ref}` }, me?.name)
              onChanged(await saveCare('complaints', c, { claim_id: cl.id }, `Carrier claim ${cl.ref} started`, me?.name)); showToast?.(`${cl.ref} added to Claims`)
            } catch (e) { showToast?.(/duplicate|unique/i.test(e?.message || '') ? 'That parcel already has a claim — see Claims' : e?.message || 'Couldn’t start the claim', 'error') } finally { setBusy(false) }
          }} />
        </div>

        {(refunds.length > 0 || returns.length > 0) && (
          <div className="card space-y-1.5">
            <div className="section-title">Linked</div>
            {refunds.map(r => <button key={r.id} className="w-full text-left flex justify-between text-sm py-1 hover:text-royal-600" onClick={() => onOpen('refunds', r.id)}><span>{r.ref} · {r.kind === 'none' ? 'no refund' : money(r.status === 'paid' ? r.paid_amount : r.amount)}</span><StatusBadge tone={REFUND_STATUS[r.status]?.tone}>{REFUND_STATUS[r.status]?.label}</StatusBadge></button>)}
            {returns.map(r => <div key={r.id} className="flex justify-between text-sm py-1"><span>{r.ref} · {itemsText(r.items)}</span><StatusBadge tone={RETURN_STATUS[r.status]?.tone}>{RETURN_STATUS[r.status]?.label}</StatusBadge></div>)}
          </div>
        )}
        <div className="card"><label className="label">Add a note</label><div className="flex gap-2"><input className="input flex-1" value={note} onChange={e => setNote(e.target.value)} placeholder="What the customer said, what we offered…" />
          <button className="btn btn-secondary btn-sm" disabled={!note.trim()} onClick={async () => { await save({}, `Note: ${note.trim()}`); setNote('') }}>Add</button></div></div>
        <Photos rec={c} table="complaints" me={me} onChanged={onChanged} showToast={showToast} />
        <History list={c.history} />
      </div>
    </Drawer>
  )
}

function RefundDrawer({ r, me, admin, claim, caseRec, showToast, onClose, onChanged, onOpen, onNavigate }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [paid, setPaid] = useState(r.amount ?? '')
  const [mref, setMref] = useState('')
  const save = async (patch, what) => { setBusy(true); try { onChanged(await saveCare('refunds', r, patch, what, me?.name)) } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error') } finally { setBusy(false) } }
  const st = REFUND_STATUS[r.status]
  return (
    <Drawer title={r.ref} onClose={onClose} description={`${REFUND_REASONS[r.reason]} · ${r.order_ref || ''}`}>
      <div className="space-y-4">
        <div className="card space-y-2">
          <div className="flex items-center justify-between"><StatusBadge tone={st?.tone}>{st?.label}</StatusBadge>
            <span className="text-lg font-semibold tabular-nums">{r.kind === 'none' ? 'No refund' : money(r.amount)} <span className="text-xs text-ink/50 font-normal">{r.kind === 'partial' ? 'part' : r.kind === 'full' ? 'full' : ''}</span></span></div>
          <div className="text-sm text-ink">{itemsText(r.items)}</div>
          <div className="text-xs text-ink/55">{[String(r.carrier || '').split(' ')[0], r.channel, r.order_total && `customer paid ${money(r.order_total)}`].filter(Boolean).join(' · ')}</div>
          <div className="border-t border-rule pt-2 text-sm">
            <Flag tone={r.recommendation === 'give' ? 'green' : 'red'}>{r.requested_by || 'Someone'} recommends {r.recommendation === 'give' ? 'giving it' : 'not giving it'}</Flag>
            {r.recommendation_note && <div className="text-ink/80 mt-1 whitespace-pre-wrap">{r.recommendation_note}</div>}
          </div>
          {caseRec && <button className="text-xs text-royal-600 hover:underline" onClick={() => onOpen('complaints', caseRec.id)}>Case {caseRec.ref} →</button>}
        </div>
        <ClaimLink claim={claim} canRaise={false} onNavigate={onNavigate} />
        {r.status === 'requested' && (admin ? (
          <div className="card space-y-2">
            <div className="section-title">Approve or decline</div>
            <input className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" />
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save({ status: 'approved', decided_by: me?.name, decided_at: new Date().toISOString(), decision_note: note.trim() || null }, `Approved${note.trim() ? ` — ${note.trim()}` : ''}`)}><Icon name="check" size={13} /> Approve</button>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => save({ status: 'declined', decided_by: me?.name, decided_at: new Date().toISOString(), decision_note: note.trim() || null }, `Declined${note.trim() ? ` — ${note.trim()}` : ''}`)}>Decline</button>
            </div>
          </div>
        ) : <div className="card text-sm text-ink/60">Waiting for an admin to approve or decline it.</div>)}
        {r.status === 'approved' && (
          <div className="card space-y-2">
            <div className="section-title">Refunded on the marketplace?</div>
            <div className="text-xs text-ink/55">Approved by {r.decided_by} {when(r.decided_at)}. Mark it refunded once it's been done on {r.channel || 'the marketplace'}.</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-ink/60">£</span><input type="number" step="0.01" className="input w-28" value={paid} onChange={e => setPaid(e.target.value)} />
              <input className="input flex-1 min-w-[140px]" value={mref} onChange={e => setMref(e.target.value)} placeholder="Refund reference (optional)" />
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy || !(Number(paid) > 0)} onClick={() => save({ status: 'paid', paid_amount: Number(paid), paid_at: new Date().toISOString(), paid_by: me?.name, marketplace_ref: mref.trim() || null }, `Refunded ${money(Number(paid))}${mref.trim() ? ` (${mref.trim()})` : ''}`)}><Icon name="pound" size={13} /> Mark refunded</button>
          </div>
        )}
        {r.status === 'paid' && <div className="card"><Flag tone="green" icon="check">Refunded {money(r.paid_amount)} on {day(r.paid_at)}{r.paid_by ? ` by ${r.paid_by}` : ''}</Flag>{r.marketplace_ref && <div className="text-xs text-ink/55 mt-1">Ref {r.marketplace_ref}</div>}</div>}
        {r.status === 'declined' && <div className="card text-sm"><Flag tone="grey">Declined by {r.decided_by} {when(r.decided_at)}</Flag>{r.decision_note && <div className="text-ink/70 mt-1">{r.decision_note}</div>}</div>}
        <History list={r.history} />
      </div>
    </Drawer>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Bars({ rows }) {
  const max = Math.max(1, ...rows.map(r => r.v))
  return (
    <div className="flex items-end gap-1 h-32">
      {rows.map(r => (
        <div key={r.k} className="flex-1 h-full flex flex-col items-center justify-end min-w-0" title={`${r.k}: ${money(r.v)}`}>
          {r.v > 0 && <div className="text-[9px] text-ink/60 tabular-nums mb-0.5">£{Math.round(r.v)}</div>}
          <div className="w-full bg-royal-500 rounded-t-[3px]" style={{ height: `${(r.v / max) * 80}%`, minHeight: r.v ? 3 : 0 }} />
          <div className="text-[9px] text-ink/45 mt-1 truncate w-full text-center">{r.label}</div>
        </div>
      ))}
    </div>
  )
}

function Dashboard({ data, inventory }) {
  const [by, setBy] = useState('day')
  const refunds = data.refunds, cases = data.complaints, returns = data.returns
  const paid = refunds.filter(r => r.status === 'paid')
  const buckets = useMemo(() => {
    const out = [], now = new Date()
    const n = by === 'day' ? 14 : by === 'week' ? 12 : 12
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now)
      if (by === 'day') d.setDate(d.getDate() - i)
      else if (by === 'week') d.setDate(d.getDate() - i * 7 - ((d.getDay() + 6) % 7))
      else { d.setDate(1); d.setMonth(d.getMonth() - i) }
      const k = by === 'month' ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10)
      out.push({ k, label: by === 'month' ? d.toLocaleDateString('en-GB', { month: 'short' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), v: 0, start: new Date(d) })
    }
    for (const r of paid) {
      const t = new Date(r.paid_at)
      const b = by === 'month' ? out.find(x => x.k === r.paid_at.slice(0, 7)) : by === 'day' ? out.find(x => x.k === r.paid_at.slice(0, 10))
        : [...out].reverse().find(x => t >= x.start)
      if (b) b.v += Number(r.paid_amount) || 0
    }
    return out
  }, [paid, by])
  const group = (list, key) => { const m = new Map(); for (const x of list) for (const k of [].concat(key(x)).filter(Boolean)) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]) }
  // Problems per product, against what it sold in the last 28 days
  const sold = new Map((inventory?.products || []).map(p => [String(p.name).toLowerCase(), Number(p.units_28) || 0]))
  const perProduct = (() => {
    const m = new Map()
    const add = (name, kind) => { if (!name) return; const k = String(name); const r = m.get(k) || { name: k, cases: 0, returns: 0 }; r[kind]++; m.set(k, r) }
    for (const c of cases) for (const i of (c.items?.length ? c.items : [{ name: c.product_name }])) add(i.name, 'cases')
    for (const r of returns) for (const i of r.items || []) add(i.name, 'returns')
    return [...m.values()].map(r => { const s = sold.get(r.name.toLowerCase()) || 0; return { ...r, sold: s, rate: s ? ((r.cases + r.returns) / s) * 100 : null } })
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || (b.cases + b.returns) - (a.cases + a.returns)).slice(0, 10)
  })()
  const sum = (xs, f) => xs.reduce((t, x) => t + (Number(f(x)) || 0), 0)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Waiting for approval" value={refunds.filter(r => r.status === 'requested').length} color={refunds.some(r => r.status === 'requested') ? 'text-warn' : 'text-ink'} sub={money(sum(refunds.filter(r => r.status === 'requested'), r => r.amount))} />
        <MetricCard label="Approved, to refund" value={refunds.filter(r => r.status === 'approved').length} sub={money(sum(refunds.filter(r => r.status === 'approved'), r => r.amount))} />
        <MetricCard label="Refunded" value={paid.length} sub={money(sum(paid, r => r.paid_amount))} color="text-ink" />
        <MetricCard label="Declined" value={refunds.filter(r => r.status === 'declined').length} />
        <MetricCard label="Returns processed" value={returns.filter(r => ['restocked', 'written_off', 'closed'].includes(r.status)).length} sub={`${returns.filter(r => r.status === 'restocked').length} back in stock`} />
        <MetricCard label="Open cases" value={cases.filter(c => c.status !== 'resolved').length} sub={`${cases.filter(c => c.status !== 'resolved' && Date.now() - Date.parse(c.created_at) > 3 * 864e5).length} over 3 days`} />
      </div>
      <div className="card">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap"><div className="section-title">Refunded value</div>
          <SegmentedControl value={by} onChange={setBy} label="By" items={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]} /></div>
        <Bars rows={buckets} />
        <div className="text-xs text-ink/50 mt-2">Total in view: {money(buckets.reduce((t, b) => t + b.v, 0))}</div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Table title="Refunds by reason" rows={group(refunds, r => REFUND_REASONS[r.reason])} extra={(k) => money(sum(refunds.filter(r => REFUND_REASONS[r.reason] === k), r => r.status === 'paid' ? r.paid_amount : r.amount))} />
        <Table title="Cases by type" rows={group(cases, c => CASE_KINDS[c.kind])} />
        <Table title="Packing errors by person" rows={group(cases.filter(c => CAUSE[c.kind] === 'packing'), c => c.packer || 'Not recorded')} />
        <Table title="Problems by carrier" rows={group([...cases, ...returns.filter(r => r.source === 'carrier')], x => String(x.carrier || x.delivered_by || '').split(' ')[0] || null)} />
        <Table title="Returns by reason" rows={group(returns, r => RETURN_REASONS[r.reason])} />
        <div className="card p-0 overflow-hidden">
          <div className="section-title px-4 py-3 border-b border-rule bg-paper">Highest problem rates</div>
          {!perProduct.length ? <div className="px-4 py-4 text-sm text-ink/45">Nothing yet.</div> : perProduct.map(p => (
            <div key={p.name} className="px-4 py-2 border-b border-rule/70 last:border-0 text-sm flex justify-between gap-2">
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 tabular-nums text-ink/70">{p.rate != null ? `${Math.round(p.rate * 10) / 10}%` : '—'} <span className="text-[11px] text-ink/45">{p.cases}c · {p.returns}r{p.sold ? ` / ${p.sold} sold` : ''}</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
function Table({ title, rows, extra }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="section-title px-4 py-3 border-b border-rule bg-paper">{title}</div>
      {!rows.length ? <div className="px-4 py-4 text-sm text-ink/45">Nothing yet.</div> : rows.slice(0, 10).map(([k, n]) => (
        <div key={k} className="px-4 py-2 border-b border-rule/70 last:border-0 flex justify-between gap-2 text-sm"><span className="truncate">{k}</span><span className="tabular-nums text-ink/70">{n}{extra ? <span className="text-[11px] text-ink/45"> · {extra(k)}</span> : ''}</span></div>
      ))}
    </div>
  )
}
