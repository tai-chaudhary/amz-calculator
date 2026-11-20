import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import { londonToday, fmtDate } from '../lib/dates'
import { PageHeader, Icon, SearchInput, EmptyState, Drawer, Modal, Spinner, StatusBadge, Flag, SuggestInput, Tabs, SegmentedControl } from './UI'
import { loadReturnsData, addCare, saveCare, uploadCarePhotos, invAdjust, returnsLookup, returnsSuggest, uploadAmazonReturns, addSafetClaim, addClaim, loadReturnsUploads } from '../lib/db'
import { smartFilter, hay } from '../lib/match'
import { takePrefill } from './OrderAuditPage'
import { OrderFinder, QtyInput, PhotoPicker, Photos, itemsText, money } from './CareParts'
import { classifyCode, REASONS, OUTCOMES, CAUSES, causeOf, statusFromItems, needsPhotos, amazonState, AMAZON_STATE, buildTodo, safetEligible, SAFET_DAYS, OVERDUE_DAYS, NOT_COMING_DAYS, daysBetween } from '../lib/returnsLogic'
import { readReturnsReport } from '../lib/returnsReport'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { StatTile, StatBand, GroupHead, Row, Thumb, Chip, AgeBar, Section, Facts, Timeline, OutcomePicker, OUTCOME_LOOK } from './ReturnsParts'
import CameraScan from './CameraScan'

const ReturnsDashboard = lazy(() => import('./ReturnsDashboard'))

/**
 * Returns (rebuilt v2.111.0 — the owner's plan of 19 Nov 2026, project doc "Returns rebuild — full plan and scope").
 *
 *   Dashboard   admins: the full picture with money; the office (Jignesh): the workload, no £ (ReturnsDashboard.jsx)
 *   To do       the office's list, built by itself, grouped by how urgent (lib/returnsLogic buildTodo)
 *   Expected    Amazon's return requests not logged yet (from the daily report upload), plus returns the office or a
 *               carrier said are coming
 *   Scan        the warehouse: phone camera or typing; matched at once by the return label's tracking, the RMA or the
 *               order; a box that matches nothing is logged anyway and the office gets suggested orders
 *   All returns everything logged; Upload: Amazon's returns report, XML or TSV
 *
 * Every tab uses the Profit & Loss page's look (ReturnsParts.jsx): a band of figure tiles that filter the list, lists
 * grouped under coloured headings, each row with the product's picture and its state. Nothing is held (the owner):
 * each item is back in stock, or disposed / faulty / not our item / empty, with photos as the evidence for SAFE-T or a
 * carrier claim. Stock goes back on the shelf as it's logged. The warehouse never sees £.
 */
export const RETURN_STATUS = {
  expected: { label: 'Expected back', tone: 'warn' }, received: { label: 'Received — to sort', tone: 'alert' },
  restocked: { label: 'Back in stock', tone: 'live' }, processed: { label: 'Part back in stock', tone: 'live' }, written_off: { label: 'Not resaleable', tone: 'alert' }, closed: { label: 'Closed', tone: 'quiet' },
}
const CARRIERS = ['Evri', 'Royal Mail', 'DHL', 'DPD', 'Parcelforce', 'Amazon', 'Other']
const carrierName = (c) => (c === 'HERMES_UK' ? 'Evri' : c === 'ROYAL_MAIL' ? 'Royal Mail' : c || '')
const KIND_CARRIER = { evri: 'Evri', evri_barcode: 'Evri', royal_mail: 'Royal Mail', dhl: 'DHL' }
const shelfOf = (p) => (p?.locations || []).find(l => l.pickable)?.code || p?.locations?.[0]?.code || ''
const toneOf = { red: 'alert', amber: 'warn', green: 'live', blue: 'info', grey: 'quiet' }
const qtyOf = (items = []) => items.reduce((t, i) => t + (Number(i.qty) || 0), 0)
const ageOf = (iso, today) => (iso ? daysBetween(iso, today) : null)
const isShopLabel = (t) => classifyCode(t || '').kind === 'evri_barcode'
const returnTone = (r) => (r.needs_match ? 'amber' : (r.items || []).some(i => i.outcome && i.outcome !== 'back_in_stock') ? 'red' : r.status === 'restocked' ? 'green' : 'grey')

/** A warning sentence that wraps (a Flag stays on one line, too long for a phone) */
const Note = ({ children, tone = 'amber' }) => (
  <div className={`rounded-[8px] border px-3 py-2.5 text-[13px] flex gap-2 items-start leading-snug ${tone === 'red' ? 'border-loss/30 bg-[#FCEFED] text-loss' : tone === 'blue' ? 'border-royal-200 bg-sky/40 text-royal-700' : 'border-warn/30 bg-[#FFF6E5] text-[#8A5A00]'}`}>
    <span className="mt-0.5"><Icon name={tone === 'blue' ? 'info' : 'alert'} size={14} /></span><span>{children}</span>
  </div>
)

export default function ReturnsPage({ me, showToast, inventory, office = false, focusId = null, onNavigate }) {
  const admin = me?.role === 'admin'
  const staff = office || admin
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const tabs = useMemo(() => (staff
    ? [{ id: 'dashboard', label: 'Dashboard' }, { id: 'todo', label: 'To do' }, { id: 'expected', label: 'Expected' }, { id: 'scan', label: 'Scan' }, { id: 'all', label: 'All returns' }, { id: 'upload', label: 'Upload' }]
    : [{ id: 'scan', label: 'Scan' }, { id: 'expected', label: 'Expected' }, { id: 'all', label: 'Logged' }]), [staff])
  const [tab, setTab] = useState(staff ? (admin ? 'dashboard' : 'todo') : 'scan')
  const [openId, setOpenId] = useState(null)
  const [openRma, setOpenRma] = useState(null)
  const [logging, setLogging] = useState(null)        // { match, scanned }
  const today = londonToday()
  const load = useCallback(() => loadReturnsData().then(d => { setData(d); setError(null) }).catch(e => { setError(e?.message || 'Couldn’t load'); setData(d => d || { returns: [], amazon: [], claims: [] }) }), [])
  useEffect(() => { load() }, [load])
  // Sent from Order Audit: log a return for that order
  useEffect(() => { const p = takePrefill(['return']); if (p?.order) { setTab('scan'); setLogging({ match: { kind: 'order', order: p.order }, scanned: null }) } }, [])
  // From ⌘K with a return's number (RT-0021) or an RMA: open it, once
  const sought = useRef(null)
  useEffect(() => { sought.current = focusId || null }, [focusId])
  useEffect(() => {
    if (!sought.current || !data) return
    const k = String(sought.current).toUpperCase()
    const hit = data.returns.find(r => r.ref === sought.current || (r.rma && r.rma.toUpperCase() === k))
    const a = !hit && data.amazon.find(x => x.rma.toUpperCase() === k)
    if (hit) { setTab('all'); setOpenId(hit.id) } else if (a) { setTab('expected'); setOpenRma(a.rma) }
    sought.current = null
  }, [data, focusId])

  const put = (row) => setData(d => ({ ...d, returns: d.returns.some(x => x.id === row.id) ? d.returns.map(x => x.id === row.id ? row : x) : [row, ...d.returns],
    amazon: row.rma ? d.amazon.map(a => (a.rma === row.rma ? { ...a, return_id: row.id } : a)) : d.amazon }))
  const products = useMemo(() => (inventory?.products || []).filter(p => p.kind !== 'packaging').map(p => ({ id: p.id, label: p.name, sub: p.code, product: p })), [inventory])
  const invById = useMemo(() => new Map((inventory?.products || []).map(p => [p.id, p])), [inventory])
  // A product's Amazon picture: the ASIN of any return request for it (the report names the ASIN of every line)
  const asinOf = useMemo(() => {
    const m = new Map()
    for (const a of data?.amazon || []) for (const i of a.items || []) if (i.product_id && a.asin && !m.has(i.product_id)) m.set(i.product_id, a.asin)
    return (pid) => (pid ? m.get(pid) || null : null)
  }, [data])
  const todo = useMemo(() => (data ? buildTodo({ returns: data.returns, amazon: data.amazon, claims: data.claims, today }) : []), [data, today])
  const counts = useMemo(() => {
    if (!data) return {}
    const exp = data.amazon.filter(a => ['on_way', 'overdue', 'delivered', 'may_come'].includes(amazonState(a, today))).length + data.returns.filter(r => r.status === 'expected').length
    return { todo: todo.length, expected: exp }
  }, [data, todo, today])
  const open = data?.returns.find(r => r.id === openId)
  const openA = data?.amazon.find(a => a.rma === openRma)
  const ctx = { data, today, asinOf, staff }

  return (
    <div>
      <PageHeader eyebrow="Warehouse / returns" title="Returns"
        description={staff ? 'Everything that comes back: Amazon’s return requests, what the warehouse logs, what needs doing, and what it costs.' : 'Scan or type the number on the return label. Then say what’s inside and take photos.'}
        actions={<button className="btn btn-primary btn-sm" onClick={() => setTab('scan')}><Icon name="camera" size={14} /> Log a return</button>} />
      {error && <Note tone="red">{error}</Note>}
      <Tabs value={tab} onChange={setTab} items={tabs.map(t => ({ ...t, count: t.id === 'todo' ? counts.todo || null : t.id === 'expected' ? counts.expected || null : null }))} />
      {!data ? <div className="surface flex justify-center py-16"><Spinner /></div> : (
        <div className="mt-1">
          {tab === 'dashboard' && <Suspense fallback={<Spinner />}><ReturnsDashboard me={me} admin={admin} data={data} todo={todo} inventory={inventory} onTab={setTab} onOpen={setOpenId} onOpenRma={setOpenRma} /></Suspense>}
          {tab === 'todo' && <TodoList ctx={ctx} todo={todo} onOpen={setOpenId} onOpenRma={setOpenRma} onTab={setTab} />}
          {tab === 'expected' && <ExpectedList ctx={ctx} onArrived={(match) => setLogging({ match, scanned: null })} onOpenRma={setOpenRma} onOpen={setOpenId} />}
          {tab === 'scan' && <ScanPanel ctx={ctx} onMatch={(match, scanned) => setLogging({ match, scanned })} onOpen={setOpenId} showToast={showToast} />}
          {tab === 'all' && <AllReturns ctx={ctx} onOpen={setOpenId} />}
          {tab === 'upload' && <UploadPanel ctx={ctx} me={me} showToast={showToast} onDone={load} />}
        </div>
      )}
      {logging && <LogBox me={me} match={logging.match} scanned={logging.scanned} products={products} invById={invById} asinOf={asinOf} showToast={showToast}
        onClose={() => setLogging(null)} onSaved={(row) => { put(row); setLogging(null); if (staff) setOpenId(row.id) }} />}
      {open && <ReturnDrawer r={open} ctx={ctx} me={me} showToast={showToast} onClose={() => setOpenId(null)} onChanged={put}
        onClaim={(c) => setData(d => ({ ...d, claims: [c, ...d.claims] }))} onNavigate={onNavigate} />}
      {openA && <AmazonDrawer a={openA} ctx={ctx} onClose={() => setOpenRma(null)} onArrived={() => { setOpenRma(null); setLogging({ match: { kind: 'amazon', amazon: openA }, scanned: null }) }}
        onOpenReturn={(id) => { setOpenRma(null); setOpenId(id) }} onNavigate={onNavigate} />}
    </div>
  )
}

// ── Scan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What a return label looks like, drawn small, so the warehouse knows which number to scan */
function LabelGuide() {
  const Item = ({ ok, title, code, sub }) => (
    <div className={`rounded-[8px] border px-3 py-2.5 ${ok ? 'bg-white border-rule' : 'bg-[#FCEFED] border-coral/30'}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink/60">
        <span className={`w-4 h-4 rounded-full flex items-center justify-center ${ok ? 'bg-gain text-white' : 'bg-loss text-white'}`}><Icon name={ok ? 'check' : 'close'} size={10} /></span>{title}
      </div>
      <div className={`font-mono text-[13px] mt-1 ${ok ? 'text-ink' : 'text-loss line-through'}`}>{code}</div>
      <div className="text-[11px] text-ink/50">{sub}</div>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2">
      <Item ok title="Evri" code="T00WLA4739542519" sub="16 characters, starts T00W" />
      <Item ok title="Royal Mail" code="OY497405041GB" sub="ends GB" />
      <Item ok title="Amazon slip" code="DGTNsWrZRRMA" sub="the RMA, ends RRMA" />
      <Item ok title="Evri shop label" code="H01FFA0002722586" sub="fine — then look for Amazon’s slip inside" />
    </div>
  )
}

function ScanPanel({ ctx, onMatch, onOpen, showToast }) {
  const { data, today, asinOf } = ctx
  const [code, setCode] = useState('')
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)            // { scanned, existing, amazon, expected, orders }
  const [shop, setShop] = useState(null)          // an Evri shop label (H…) scanned first: kept while the slip inside is scanned
  const input = useRef(null)
  useEffect(() => { input.current?.focus() }, [])
  const recent = data.returns.filter(r => r.status !== 'expected' && String(r.received_at || '').slice(0, 10) === today)

  const look = async (raw) => {
    const first = classifyCode(raw)
    const scanned = shop && first.kind !== 'evri_barcode' ? { ...first, shopCode: shop } : first
    if (scanned.kind === 'empty') return
    setCode(scanned.value || raw)
    setBusy(true); setRes(null)
    try {
      const r = await returnsLookup(scanned.value || raw)
      const out = { scanned, existing: r?.existing || [], amazon: (r?.amazon || []).filter(a => !a.return_id), amazonLogged: (r?.amazon || []).filter(a => a.return_id), expected: r?.expected || [], orders: r?.orders || [] }
      setRes(out)
      // One clear answer: go straight to logging it
      if (!out.existing.length && !scanned.warn) {
        if (out.amazon.length === 1 && !out.expected.length) onMatch({ kind: 'amazon', amazon: out.amazon[0] }, scanned)
        else if (!out.amazon.length && out.expected.length === 1) onMatch({ kind: 'expected', row: out.expected[0] }, scanned)
      }
    } catch (e) { showToast?.(e?.message || 'Couldn’t look it up', 'error') } finally { setBusy(false) }
  }
  const reset = () => { setCode(''); setRes(null); setShop(null); setTimeout(() => input.current?.focus(), 50) }
  const nothing = res && !res.existing.length && !res.amazon.length && !res.expected.length && !res.orders.length

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
      <div className="lg:col-span-7 space-y-3">
        <div className="bg-ink text-white rounded-card px-5 pt-5 pb-5" data-scan-hero>
          <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-sky">Something’s come back</div>
          <div className="text-[22px] font-bold leading-tight mt-1">Scan the return label</div>
          <div className="w-16 h-1 bg-lime rounded-sm mt-2.5" />
          <button type="button" className="mt-4 w-full flex items-center justify-center gap-2.5 bg-lime text-ink font-bold text-[17px] rounded-[10px] py-4 hover:brightness-95 active:scale-[0.99] transition" onClick={() => setCamera(true)}>
            <Icon name="camera" size={20} /> Scan with the camera
          </button>
          <form onSubmit={e => { e.preventDefault(); look(code) }} className="mt-3 flex gap-2">
            <input ref={input} className="flex-1 min-w-0 rounded-[8px] bg-white text-ink font-mono text-base px-3.5 py-3 placeholder:text-ink/35 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-lime"
              value={code} onChange={e => setCode(e.target.value)} placeholder="…or type the number" autoCapitalize="characters" autoCorrect="off" spellCheck={false} aria-label="Tracking, RMA or order number" />
            <button className="rounded-[8px] bg-white/15 border border-white/30 text-white font-semibold px-4 disabled:opacity-40" disabled={busy || !code.trim()}>{busy ? '…' : 'Find'}</button>
          </form>
          <button type="button" className="mt-3 text-sm text-sky hover:text-white inline-flex items-center gap-1.5" onClick={() => onMatch({ kind: 'unknown' }, classifyCode(code))}><Icon name="plus" size={13} /> No label to scan — log it by hand</button>
        </div>

        {shop && !res && <Note tone="blue">Evri shop label <b className="font-mono">{shop}</b> kept — now scan Amazon’s slip from inside the box, or type the order number. <button className="underline ml-1" onClick={reset}>Start again</button></Note>}
        {res && (
          <div className="space-y-2.5" data-scan-result>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="text-sm min-w-0"><span className="text-ink/55">{res.scanned.label}</span> <b className="font-mono break-all">{res.scanned.value}</b>{res.scanned.shopCode && <span className="text-ink/55"> · Evri shop label <span className="font-mono">{res.scanned.shopCode}</span></span>}</div>
              <button className="btn btn-ghost btn-xs shrink-0" onClick={reset}>Scan another</button>
            </div>
            {res.scanned.warn && <Note>{res.scanned.warn}</Note>}
            {res.existing.map(x => (
              <div key={x.id} className="rounded-card border border-coral/30 bg-[#FDF3F1] p-4">
                <div className="text-[11px] uppercase tracking-[0.08em] font-bold text-loss">Already logged</div>
                <div className="text-[15px] font-semibold mt-1">{x.ref} · {itemsText(x.items) || 'products not set'}</div>
                <div className="text-xs text-ink/55">{x.received_at ? `Logged ${fmtDate(x.received_at)}` : ''}{x.order_ref ? ` · ${x.order_ref}` : ''}</div>
                <button className="btn btn-secondary btn-sm mt-2.5" onClick={() => onOpen(x.id)}>Open {x.ref}</button>
              </div>
            ))}
            {res.amazonLogged.length > 0 && !res.existing.length && <Note>Amazon return {res.amazonLogged[0].rma} is already logged.</Note>}
            {res.amazon.map(a => (
              <MatchCard key={a.rma} label="Amazon return" asin={a.asin} qty={a.qty} title={itemsText(a.items) || a.item_name}
                lines={`${REASONS[a.reason] || a.reason} · requested ${fmtDate(a.request_date)}`} chips={[a.order_ref, a.rma]} action="Log it" onClick={() => onMatch({ kind: 'amazon', amazon: a }, res.scanned)} />
            ))}
            {res.expected.map(x => (
              <MatchCard key={x.id} label={x.source === 'carrier' ? 'Carrier return — expected' : 'Expected back'} asin={asinOf((x.expected_items || x.items || [])[0]?.product_id)} qty={qtyOf(x.expected_items || x.items)}
                title={itemsText(x.expected_items || x.items)} lines={REASONS[x.reason] || x.reason} chips={[x.ref, x.order_ref].filter(Boolean)} action="It’s arrived" onClick={() => onMatch({ kind: 'expected', row: x }, res.scanned)} />
            ))}
            {!res.amazon.length && !res.expected.length && res.orders.slice(0, 5).map(o => (
              <MatchCard key={o.label_id} label="Our order" asin={asinOf((o.contents || [])[0]?.product_id)} qty={qtyOf(o.contents || o.items)} title={itemsText(o.contents || o.items)}
                lines={[o.carrier && String(o.carrier).split(' ')[0], o.shipped_at && `sent ${fmtDate(o.shipped_at)}`].filter(Boolean).join(' · ')} chips={[o.order_ref, o.tracking].filter(Boolean)} action="This one" onClick={() => onMatch({ kind: 'order', order: o }, res.scanned)} />
            ))}
            {nothing && res.scanned.kind === 'evri_barcode' && (
              <div className="rounded-card border-2 border-warn/40 bg-[#FFF6E5] p-4" data-evri-shop>
                <div className="text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8A5A00]">Evri shop label</div>
                <div className="text-[16px] font-bold mt-1 leading-snug">Open the box and look for Amazon’s slip</div>
                <div className="text-[13px] text-ink/65 mt-1 leading-snug">The customer posted it at an Evri shop, so this number isn’t in Amazon’s report. Amazon’s return slip or packing slip inside has the RMA (ends RRMA) or the order number — scan that and it matches straight away.</div>
                <div className="flex flex-col sm:flex-row gap-2 mt-3">
                  <button className="btn btn-primary justify-center" onClick={() => { setShop(res.scanned.value); setCode(''); setRes(null); setCamera(true) }}><Icon name="camera" size={14} /> Scan the slip</button>
                  <button className="btn btn-secondary justify-center" onClick={() => onMatch({ kind: 'unknown' }, res.scanned)}>No slip — log what’s inside</button>
                </div>
                <div className="text-[11.5px] text-ink/50 mt-2">No slip: the office gets suggested orders from the products and the day Amazon says each return was delivered.</div>
              </div>
            )}
            {nothing && res.scanned.kind !== 'evri_barcode' && (
              <div className="rounded-card border border-rule bg-white p-4">
                <div className="text-[15px] font-semibold">Nothing found for this number</div>
                <div className="text-[13px] text-ink/60 mt-1">You can still log it: say what’s inside and the office finds the order — the portal suggests the likely ones.</div>
                <button className="btn btn-primary btn-sm mt-3" onClick={() => onMatch({ kind: 'unknown' }, res.scanned)}><Icon name="inbox" size={13} /> Log it as an unknown parcel</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="lg:col-span-5 space-y-3">
        <Section title="Which number to scan">
          <LabelGuide />
          <div className="text-[12px] text-ink/55 mt-2.5 leading-relaxed">A parcel <b>we sent</b> that the carrier brought back: scan <b>our</b> label. Nothing to scan: log it by hand — the office finds the order.</div>
        </Section>
        <div className="surface overflow-hidden">
          <GroupHead tone={recent.length ? 'green' : 'grey'} title="Logged today" count={recent.length} />
          {!recent.length ? <div className="px-4 py-5 text-sm text-ink/45">Nothing logged yet today.</div> : recent.slice(0, 15).map(r => (
            <Row key={r.id} tone={returnTone(r)} onClick={() => onOpen(r.id)} thumb={<Thumb asin={asinOf(r.items?.[0]?.product_id)} size={40} count={qtyOf(r.items)} />}
              title={<span><span className="text-ink/45 font-mono text-[12px] mr-1.5">{r.ref}</span>{itemsText(r.items) || 'Products not set'}</span>}
              right={r.needs_match ? <Flag tone="amber">Office to match</Flag> : <StatusBadge tone={RETURN_STATUS[r.status]?.tone}>{RETURN_STATUS[r.status]?.label}</StatusBadge>} />
          ))}
        </div>
      </div>
      {camera && <CameraScan onClose={() => setCamera(false)} onCode={(t) => { setCamera(false); look(t) }} />}
    </div>
  )
}

/** A found return or order, big enough to tap with a thumb */
function MatchCard({ label, asin, qty, title, lines, chips = [], action, onClick }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left rounded-card border-2 border-royal-200 bg-white hover:border-royal-500 p-3.5 flex items-center gap-3 transition" data-match-card>
      <Thumb asin={asin} size={60} count={qty} />
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-[0.08em] font-bold text-royal-600">{label}</div>
        <div className="text-[15px] font-semibold text-ink leading-snug">{title}</div>
        <div className="text-[12.5px] text-ink/60">{lines}</div>
        {chips.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{chips.map(c => <Chip key={c} mono>{c}</Chip>)}</div>}
      </div>
      <span className="shrink-0 bg-royal-500 text-white text-sm font-semibold rounded-[8px] px-3 py-2 inline-flex items-center gap-1">{action} <Icon name="chevronRight" size={14} /></span>
    </button>
  )
}

// ── Log what's in the box ────────────────────────────────────────────────────────────────────────────────────────────
function LogBox({ me, match, scanned, products, invById, asinOf, showToast, onClose, onSaved }) {
  const a = match.kind === 'amazon' ? match.amazon : null
  const ex = match.kind === 'expected' ? match.row : null
  const ord = match.kind === 'order' ? match.order : null
  const expectedItems = a?.items || ex?.expected_items || (ex ? ex.items : null) || ord?.contents || ord?.items || []
  const lineFor = (i, k) => {
    const p = i.product_id ? invById.get(i.product_id) : null
    return { key: `${k}|${i.product_id || i.code || i.name}`, product_id: i.product_id || null, name: p?.name || i.name || i.code, code: p?.code || i.code || null,
      qty: Number(i.qty) || 1, expected: Number(i.qty) || 1, outcome: 'back_in_stock', location: shelfOf(p) }
  }
  const [items, setItems] = useState(() => expectedItems.map(lineFor))
  const [delivered, setDelivered] = useState(scanned?.shopCode ? 'Evri' : carrierName(a?.carrier) || KIND_CARRIER[scanned?.kind] || '')
  const [typed, setTyped] = useState('')
  const [files, setFiles] = useState([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key, patch) => setItems(xs => xs.map(x => (x.key === key ? { ...x, ...patch } : x)))
  const why = !items.length ? 'Add what’s in the box'
    : items.some(i => i.outcome === 'back_in_stock' && !i.product_id) ? 'Pick the product from the list (so it can go back in stock)'
    : items.some(i => i.outcome === 'back_in_stock' && !i.location) ? 'Say which shelf it’s going on'
    : !files.length ? (needsPhotos(items) ? 'Add photos — they’re the evidence for a claim' : 'Add at least one photo') : null
  const short = items.filter(i => i.expected && i.qty < i.expected)
  const back = items.filter(i => i.outcome === 'back_in_stock').reduce((t, i) => t + (Number(i.qty) || 0), 0)
  const bad = items.filter(i => i.outcome !== 'back_in_stock').reduce((t, i) => t + (Number(i.qty) || 0), 0)
  const head = a ? { label: 'Amazon return', title: a.order_ref, sub: `${REASONS[a.reason] || a.reason} · requested ${fmtDate(a.request_date)}${a.self_post ? ' · customer posted it' : ''}` }
    : ex ? { label: ex.source === 'carrier' ? 'Carrier return' : 'Expected back', title: ex.order_ref || ex.ref, sub: REASONS[ex.reason] || ex.reason }
    : ord ? { label: 'Our order', title: ord.order_ref, sub: [ord.carrier && String(ord.carrier).split(' ')[0], ord.shipped_at && `sent ${fmtDate(ord.shipped_at)}`].filter(Boolean).join(' · ') }
    : scanned?.kind === 'evri_barcode' ? { label: 'Evri shop label — no slip', title: scanned.value, sub: 'Say what’s inside — the office finds the order' }
    : { label: 'Unknown parcel', title: 'No order yet', sub: 'Say what’s inside — the office finds the order' }

  const save = async () => {
    setBusy(true)
    try {
      const now = new Date().toISOString()
      const lines = items.map(({ key, ...i }) => ({ ...i, location: i.outcome === 'back_in_stock' ? i.location : null }))
      const backL = lines.filter(l => l.outcome === 'back_in_stock'), gone = lines.filter(l => l.outcome !== 'back_in_stock')
      const status = statusFromItems(lines)
      const how = a || ex ? (scanned?.kind === 'rma' ? 'rma' : ['evri', 'royal_mail', 'dhl', 'other'].includes(scanned?.kind) ? 'tracking' : scanned?.kind === 'amazon_order' ? 'order' : 'expected') : ord ? 'order' : null
      const base = {
        status, items: lines, received_at: now, received_by: me?.name || null, notes: notes.trim() || ex?.notes || null, delivered_by: delivered || null,
        condition: gone.length ? (backL.length ? 'part_damaged' : 'damaged') : 'resaleable', outcome: status === 'processed' ? 'mixed' : status === 'restocked' ? 'back_in_stock' : 'disposed',
        ...(scanned?.shopCode ? { return_tracking: scanned.shopCode } : scanned?.value && scanned.kind !== 'amazon_order' ? { return_tracking: scanned.value } : {}),
        match_how: how, match_score: how ? 100 : null,
      }
      let row
      if (a) {
        row = await addCare('returns', { ...base, rma: a.rma, order_ref: a.order_ref, channel: 'Amazon', source: 'customer', reason: a.reason || 'other', amazon_reason: a.reason_code,
          expected_items: a.items, needs_match: false, matched_at: now, matched_by: me?.name || 'Scan', ...(a.tracking && !base.return_tracking ? { return_tracking: a.tracking } : {}) }, me?.name)
      } else if (ex) {
        row = await saveCare('returns', ex, { ...base, needs_match: false, matched_at: ex.matched_at || now, matched_by: ex.matched_by || me?.name || null },
          `Arrived — ${backL.length} back in stock, ${gone.length} not resaleable`, me?.name)
      } else if (ord) {
        const ours = scanned?.value && ord.tracking && scanned.value.replace(/\W/g, '').toUpperCase() === String(ord.tracking).replace(/\W/g, '').toUpperCase()
        row = await addCare('returns', { ...base, order_ref: ord.order_ref, tracking: ord.tracking, carrier: ord.carrier, channel: ord.channel || null, ordered: ord.items || [],
          expected_items: ord.contents || null, source: ours ? 'carrier' : 'unknown', reason: ours ? 'returned_to_sender' : 'to_check', needs_match: false, matched_at: now, matched_by: me?.name || 'Scan' }, me?.name)
      } else {
        row = await addCare('returns', { ...base, source: 'unknown', reason: 'to_check', needs_match: true }, me?.name)
      }
      // Back on the shelf as it's logged. The note names the return and the order: the costing reads them (back-in-stock credit)
      for (const l of backL) {
        if (!l.product_id) continue
        await invAdjust({ productId: l.product_id, location: l.location, qty: l.qty, reason: 'Customer return', note: `${row.ref}${row.order_ref ? ` · ${row.order_ref}` : ''}`, by: me?.name })
      }
      const paths = await uploadCarePhotos(row.id, files)
      row = await saveCare('returns', row, { photos: [...(row.photos || []), ...paths] }, null, me?.name)
      showToast?.(`${row.ref} logged${back ? ` — ${back} back in stock` : ''}${bad ? `${back ? ',' : ' —'} ${bad} not resaleable` : ''}${row.needs_match ? ' · the office will find the order' : ''}`)
      onSaved(row)
    } catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
  }

  return (
    <Modal title="Log a return" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3 -mt-1">
        <div className="rounded-card bg-ink text-white px-4 py-3 flex items-center gap-3" data-logbox-head>
          <Thumb asin={a?.asin || asinOf(expectedItems[0]?.product_id)} size={48} />
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-sky">{head.label}</div>
            <div className="text-[16px] font-bold leading-tight font-mono">{head.title}</div>
            <div className="text-[12px] text-sky truncate">{head.sub}</div>
          </div>
        </div>
        {scanned?.warn && <Note>{scanned.warn}</Note>}
        <Section step={1} title="Who brought it back?">
          <div className="flex flex-wrap gap-1.5">{CARRIERS.map(c => <button key={c} type="button" className={`px-3 py-2 rounded-[8px] border text-sm font-semibold ${delivered === c ? 'bg-royal-500 border-royal-500 text-white' : 'bg-white border-rule text-ink/75 hover:border-royal-300'}`} onClick={() => setDelivered(delivered === c ? '' : c)}>{c}</button>)}</div>
        </Section>
        <Section step={2} title="What’s inside — and what state is each in?" right={items.length ? <span className="text-[11px] text-ink/50">{back} back in stock · {bad} not resaleable</span> : null}>
          <div className="space-y-2.5">
            {items.map(i => (
              <div key={i.key} className="rounded-[10px] border border-rule bg-paper/50 p-3 space-y-2.5" data-return-line>
                <div className="flex items-center gap-3">
                  <Thumb asin={asinOf(i.product_id) || a?.asin} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-ink leading-snug">{i.name}</div>
                    {i.expected ? <div className={`text-[11.5px] ${i.qty < i.expected ? 'text-loss font-semibold' : 'text-ink/50'}`}>{i.expected} expected</div> : <div className="text-[11.5px] text-ink/50">added by hand</div>}
                  </div>
                  <QtyInput value={i.qty} min={0} onChange={n => set(i.key, { qty: n })} className="input w-16 text-center text-base sm:text-sm" aria-label="How many" />
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setItems(xs => xs.filter(x => x.key !== i.key))} aria-label="Remove"><Icon name="close" size={12} /></button>
                </div>
                <OutcomePicker value={i.outcome} onChange={k => set(i.key, { outcome: k })} />
                {i.outcome === 'back_in_stock' && (
                  <div className="flex items-center gap-2 text-sm">
                    <Icon name="pin" size={13} /><span className="text-ink/60">Shelf</span>
                    <input className="input w-36 font-mono uppercase text-base sm:text-sm" value={i.location} onChange={e => set(i.key, { location: e.target.value.toUpperCase() })} placeholder="e.g. C-5-1-1" />
                    {i.product_id && i.location && i.location === shelfOf(invById.get(i.product_id)) && <Chip tone="green">its pick shelf</Chip>}
                  </div>
                )}
              </div>
            ))}
            {short.length > 0 && <Note>Fewer than expected: {short.map(s => `${s.name} ${s.qty} of ${s.expected}`).join(', ')}. If the box was short, choose “Empty / short” for the missing ones.</Note>}
            <SuggestInput value={typed} onChange={setTyped} options={products} placeholder="+ Add a product (something else in the box)"
              onPick={o => { if (o) { const p = invById.get(o.id); setItems(xs => [...xs, { key: `p|${o.id}|${xs.length}`, product_id: o.id, name: o.label, code: o.sub, qty: 1, expected: null, outcome: 'back_in_stock', location: shelfOf(p) }]); setTyped('') } }} />
          </div>
        </Section>
        <Section step={3} title={needsPhotos(items) ? 'Photos — required' : 'Photos'} tone={needsPhotos(items) && !files.length ? 'coral' : undefined}
          right={needsPhotos(items) ? <span className="text-[11px] text-loss font-semibold">the evidence for a claim</span> : null}>
          <PhotoPicker files={files} onChange={setFiles} label={needsPhotos(items) ? 'The box, the label, and the damage or what’s wrong' : 'The box, its label, what’s inside'} />
        </Section>
        <Section step={4} title="Notes (optional)">
          <input className="input text-base sm:text-sm" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything on the label or a slip inside" aria-label="Notes" />
        </Section>
        <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 bg-gradient-to-t from-white via-white to-white/0">
          <button className={`w-full justify-center py-3.5 rounded-[10px] text-[15px] font-bold inline-flex items-center gap-2 ${why ? 'bg-rule text-ink/55' : 'bg-royal-500 text-white hover:bg-royal-600'}`} disabled={busy || !!why} onClick={save} data-log-return>
            {!why && <Icon name="check" size={16} />}{why || (busy ? 'Saving…' : `Log it — ${back} back in stock${bad ? `, ${bad} not resaleable` : ''}`)}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Expected ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const EXP_GROUPS = [
  { id: 'delivered', tone: 'red', title: 'Amazon says delivered — not logged', hint: 'find the box in the warehouse and log it' },
  { id: 'overdue', tone: 'amber', title: 'Overdue', hint: `prepaid label, over ${OVERDUE_DAYS} days` },
  { id: 'expected', tone: 'blue', title: 'Carrier returns and office expects', hint: 'coming back to us' },
  { id: 'on_way', tone: 'blue', title: 'On its way', hint: 'prepaid label' },
  { id: 'may_come', tone: 'grey', title: 'Customer posts it', hint: `no tracking; not coming back after ${NOT_COMING_DAYS} days` },
  { id: 'not_coming', tone: 'grey', title: 'Not coming back', hint: `self-post, over ${NOT_COMING_DAYS} days` },
]
function ExpectedList({ ctx, onArrived, onOpenRma, onOpen }) {
  const { data, today, asinOf, staff } = ctx
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(null)
  const rows = useMemo(() => [
    ...data.amazon.map(a => ({ type: 'amazon', id: a.rma, a, state: amazonState(a, today), date: a.request_date })),
    ...data.returns.filter(r => r.status === 'expected').map(r => ({ type: 'expected', id: r.id, r, state: 'expected', date: r.created_at })),
  ], [data, today])
  const n = (s) => rows.filter(x => x.state === s).length
  const shown = smartFilter(rows.filter(x => (only ? x.state === only : !['before', 'logged', 'not_coming'].includes(x.state))), q,
    x => (x.type === 'amazon' ? hay(x.a.order_ref, x.a.rma, x.a.tracking, x.a.item_name, x.a.sku, itemsText(x.a.items)) : hay(x.r.ref, x.r.order_ref, x.r.tracking, itemsText(x.r.expected_items || x.r.items))), { keepOrder: true })
  const groups = EXP_GROUPS.map(g => ({ ...g, list: shown.filter(x => x.state === g.id).sort((p, r) => String(p.date).localeCompare(String(r.date))) })).filter(g => g.list.length)
  const tile = (id) => ({ active: only === id, onClick: () => setOnly(only === id ? null : id) })

  return (
    <>
      <StatBand>
        <StatTile label="Delivered, not logged" value={n('delivered')} sub="Amazon says we have it" tone={n('delivered') ? 'red' : 'none'} {...tile('delivered')} />
        <StatTile label="Overdue" value={n('overdue')} sub={`prepaid, over ${OVERDUE_DAYS} days`} tone={n('overdue') ? 'amber' : 'none'} {...tile('overdue')} />
        <StatTile label="On its way" value={n('on_way') + n('expected')} sub={`${n('on_way')} Amazon · ${n('expected')} carrier / office`} tone="blue" {...tile('on_way')} />
        <StatTile label="Customer posts it" value={n('may_come')} sub={`${n('not_coming')} not coming back`} {...tile('may_come')} />
      </StatBand>
      <div className="filter-bar mb-3">
        {only ? <button className="btn btn-secondary btn-sm" onClick={() => setOnly(null)}><Icon name="close" size={12} /> Showing: {EXP_GROUPS.find(g => g.id === only)?.title}</button>
          : <span className="text-sm text-ink/55">Still to come, most urgent first</span>}
        <button className={`btn btn-sm ${only === 'not_coming' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOnly(only === 'not_coming' ? null : 'not_coming')}>Not coming back {n('not_coming')}</button>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Order, RMA, tracking, product" className="w-full sm:w-72 sm:ml-auto" />
      </div>
      {!groups.length ? <div className="surface"><EmptyState icon="inbox" title="Nothing expected back" sub={staff ? 'Upload Amazon’s returns report on the Upload tab and the requests show here.' : 'When a return arrives, scan it on the Scan tab.'} /></div> : (
        <div className="surface overflow-hidden">
          {groups.map(g => (
            <div key={g.id}>
              <GroupHead tone={g.tone} title={g.title} count={g.list.length} hint={g.hint} />
              {g.list.slice(0, 200).map(x => {
                if (x.type === 'expected') {
                  const r = x.r, its = r.expected_items || r.items || []
                  return <Row key={x.id} tone={g.tone} onClick={() => onArrived({ kind: 'expected', row: r })} testid="expected"
                    thumb={<Thumb asin={asinOf(its[0]?.product_id)} count={qtyOf(its)} />} title={itemsText(its) || 'Products not set'}
                    lines={<>{REASONS[r.reason] || r.reason} · since {fmtDate(r.created_at)}</>}
                    chips={<>{r.order_ref && <Chip mono>{r.order_ref}</Chip>}<Chip tone={r.source === 'carrier' ? 'amber' : 'blue'}>{r.source === 'carrier' ? 'Carrier is returning it' : 'Office expects it'}</Chip><Chip mono>{r.ref}</Chip></>}
                    right={<span className="btn btn-primary btn-sm">It’s arrived</span>} />
                }
                const a = x.a, age = ageOf(a.request_date, today)
                return <Row key={x.id} tone={g.tone} testid="amazon" onClick={() => (staff ? onOpenRma(a.rma) : onArrived({ kind: 'amazon', amazon: a }))}
                  thumb={<Thumb asin={a.asin} count={a.qty} />} title={itemsText(a.items) || a.item_name}
                  lines={<>{REASONS[a.reason] || a.reason} · requested {fmtDate(a.request_date)}{a.delivered_at ? <> · <b className="text-loss">delivered {fmtDate(a.delivered_at)}</b></> : ''}</>}
                  chips={<><Chip mono>{a.order_ref}</Chip>{a.self_post ? <Chip>Customer posts it</Chip> : <Chip mono icon="truck">{carrierName(a.carrier)} {a.tracking}</Chip>}{a.prime && <Chip tone="blue">Prime</Chip>}</>}
                  right={<>{['on_way', 'overdue', 'may_come'].includes(x.state) ? <AgeBar days={age} limit={a.self_post ? NOT_COMING_DAYS : OVERDUE_DAYS} /> : <StatusBadge tone={toneOf[AMAZON_STATE[x.state].tone]}>{AMAZON_STATE[x.state].label}</StatusBadge>}
                    {x.state !== 'not_coming' && <span className="btn btn-secondary btn-sm">{staff ? 'Open' : 'It’s arrived'}</span>}</>} />
              })}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── To do (office) ───────────────────────────────────────────────────────────────────────────────────────────────────
const TODO_KIND = {
  safet: { label: 'SAFE-T to file', icon: 'receipt', action: 'Start SAFE-T' }, safet_action: { label: 'SAFE-T needs a reply', icon: 'alert', action: 'Open' },
  no_request: { label: 'No Amazon request', icon: 'info', action: 'Check it' }, not_logged: { label: 'Delivered, not logged', icon: 'inbox', action: 'Open' },
  overdue: { label: 'Overdue', icon: 'clock', action: 'Open' }, match: { label: 'Find the order', icon: 'search', action: 'Find the order' },
  carrier_claim: { label: 'Carrier claim', icon: 'truck', action: 'Raise claim' },
}
const TODO_GROUPS = [
  { id: 'now', tone: 'red', title: 'Act today', hint: 'deadlines and boxes we can’t account for', test: t => t.tone === 'red' },
  { id: 'soon', tone: 'amber', title: 'This week', hint: 'claims to raise and parcels to chase', test: t => t.tone === 'amber' && ['safet', 'carrier_claim', 'overdue', 'no_request'].includes(t.kind) },
  { id: 'match', tone: 'blue', title: 'Match to an order', hint: 'the portal suggests the likely orders', test: t => t.kind === 'match' },
]
function TodoList({ ctx, todo, onOpen, onOpenRma, onTab }) {
  const { data, asinOf } = ctx
  const [kind, setKind] = useState(null)
  const list = todo.filter(t => !kind || t.kind === kind)
  const n = (k) => todo.filter(t => t.kind === k).length
  const nextSafet = todo.filter(t => t.kind === 'safet').sort((a, b) => a.due - b.due)[0]
  const used = new Set()
  const groups = TODO_GROUPS.map(g => { const l = list.filter(t => !used.has(t.id) && g.test(t)); l.forEach(t => used.add(t.id)); return { ...g, list: l } })
  const rest = list.filter(t => !used.has(t.id))
  if (rest.length) groups.push({ id: 'rest', tone: 'grey', title: 'When you can', list: rest })
  const tile = (k) => ({ active: kind === k, onClick: () => setKind(kind === k ? null : k) })
  const thumbFor = (t) => {
    const r = data.returns.find(x => x.id === t.ref), a = data.amazon.find(x => x.rma === t.ref)
    return <Thumb asin={a?.asin || asinOf(r?.items?.[0]?.product_id)} size={44} count={a?.qty || qtyOf(r?.items)} />
  }
  return (
    <>
      <StatBand>
        <StatTile label="SAFE-T to file" value={n('safet')} sub={nextSafet ? `next deadline in ${nextSafet.due} day${nextSafet.due === 1 ? '' : 's'}` : 'nothing waiting'} tone={nextSafet && nextSafet.due <= 5 ? 'red' : n('safet') ? 'amber' : 'none'} {...tile('safet')} />
        <StatTile label="Delivered, not logged" value={n('not_logged')} sub="Amazon says we have it" tone={n('not_logged') ? 'red' : 'none'} {...tile('not_logged')} />
        <StatTile label="Overdue" value={n('overdue')} sub={`prepaid, over ${OVERDUE_DAYS} days`} tone={n('overdue') ? 'amber' : 'none'} {...tile('overdue')} />
        <StatTile label="To match" value={n('match')} sub="no exact order found" tone={n('match') ? 'blue' : 'none'} {...tile('match')} />
      </StatBand>
      {kind && <div className="mb-3"><button className="btn btn-secondary btn-sm" onClick={() => setKind(null)}><Icon name="close" size={12} /> Showing: {TODO_KIND[kind].label} — show everything</button></div>}
      {!list.length ? (
        <div className="surface py-10 flex flex-col items-center text-center px-6">
          <span className="w-12 h-12 rounded-full bg-lime/40 flex items-center justify-center text-ink"><Icon name="check" size={22} /></span>
          <div className="text-[17px] font-bold mt-3">Nothing to do</div>
          <div className="text-sm text-ink/55 mt-1 max-w-md">SAFE-T claims, returns Amazon says we have, overdue returns and parcels to match show here by themselves.</div>
          <button className="btn btn-secondary btn-sm mt-4" onClick={() => onTab('upload')}>Upload today’s Amazon report</button>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          {groups.filter(g => g.list.length).map(g => (
            <div key={g.id}>
              <GroupHead tone={g.tone} title={g.title} count={g.list.length} hint={g.hint} />
              {g.list.map(t => {
                const isReturn = data.returns.some(r => r.id === t.ref), k = TODO_KIND[t.kind]
                const go = () => (isReturn ? onOpen(t.ref) : onOpenRma(t.ref))
                return (
                  <Row key={t.id} tone={t.tone === 'red' ? 'red' : t.tone === 'amber' ? 'amber' : 'blue'} onClick={go} testid={`todo-${t.kind}`} thumb={thumbFor(t)}
                    title={t.title} lines={t.sub}
                    chips={<><Chip tone={t.tone === 'red' ? 'red' : t.tone === 'amber' ? 'amber' : 'blue'} icon={k.icon}>{k.label}</Chip>{isReturn && isShopLabel(data.returns.find(r => r.id === t.ref)?.return_tracking) && <Chip tone="amber">Evri shop label</Chip>}</>}
                    right={<>{t.kind === 'safet' && <span className={`text-[12px] font-bold tabular-nums ${t.due <= 5 ? 'text-loss' : 'text-warn'}`}>{t.due} day{t.due === 1 ? '' : 's'} left</span>}
                      <button type="button" className={`btn btn-sm ${t.tone === 'red' ? 'btn-primary' : 'btn-secondary'}`} onClick={(e) => { e.stopPropagation(); go() }}>{k.action}</button></>} />
                )
              })}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── All returns ──────────────────────────────────────────────────────────────────────────────────────────────────────
function AllReturns({ ctx, onOpen }) {
  const { data, today, asinOf, staff } = ctx
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all')
  const [days, setDays] = useState(30)
  const logged = data.returns.filter(r => r.status !== 'expected')
  const recent = logged.filter(r => !days || ageOf(r.received_at || r.created_at, today) <= days)
  const VIEW = { all: () => true, match: r => r.needs_match, bad: r => (r.items || []).some(i => i.outcome && i.outcome !== 'back_in_stock'), stock: r => r.status === 'restocked' || r.status === 'processed' }
  const list = smartFilter(recent.filter(VIEW[show]), q, r => hay(r.ref, r.order_ref, r.rma, r.tracking, r.return_tracking, itemsText(r.items), r.delivered_by, REASONS[r.reason], r.received_by), { keepOrder: true })
  const units = (xs, test) => xs.reduce((t, r) => t + (r.items || []).filter(test).reduce((s, i) => s + (Number(i.qty) || 0), 0), 0)
  const backU = units(recent, i => i.outcome === 'back_in_stock' || (!i.outcome && i.location)), badU = units(recent, i => i.outcome && i.outcome !== 'back_in_stock')
  const csv = () => exportRowsToCsv(stampedName('returns'), list.map(r => ({
    Return: r.ref, Arrived: fmtDate(r.received_at || r.created_at), 'Logged by': r.received_by || '', Order: r.order_ref || '', RMA: r.rma || '', Channel: r.channel || '',
    Reason: REASONS[r.reason] || r.reason, Cause: CAUSES[causeOf(r.reason)].label, Items: (r.items || []).map(i => `${i.qty} × ${i.name} (${OUTCOMES[i.outcome]?.short || i.outcome || ''})`).join('; '),
    'Brought by': r.delivered_by || '', 'Return tracking': r.return_tracking || '', Matched: r.needs_match ? 'No' : (r.match_how || 'Yes'), Photos: (r.photos || []).length,
  })))
  const tile = (id) => ({ active: show === id, onClick: () => setShow(show === id ? 'all' : id) })
  return (
    <>
      <StatBand>
        <StatTile label="Logged" value={recent.length} sub={days ? `in the last ${days} days` : 'since logging began'} tone="ink" active={show === 'all'} onClick={() => setShow('all')} />
        <StatTile label="Back in stock" value={backU} sub="units put on the shelf" tone="green" {...tile('stock')} />
        <StatTile label="Not resaleable" value={badU} sub="units damaged, faulty, not ours or missing" tone={badU ? 'red' : 'none'} {...tile('bad')} />
        <StatTile label="To match" value={recent.filter(VIEW.match).length} sub="order not found yet" tone={recent.some(VIEW.match) ? 'amber' : 'none'} {...tile('match')} />
      </StatBand>
      <div className="filter-bar mb-3">
        <SegmentedControl value={String(days)} onChange={v => setDays(Number(v))} label="When" items={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }, { id: '0', label: 'All' }]} />
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Return, order, RMA, tracking, product" className="w-full sm:w-72 sm:ml-auto" />
        {staff && <button className="btn btn-secondary btn-sm" onClick={csv}><Icon name="download" size={13} /> CSV</button>}
      </div>
      {!list.length ? <div className="surface"><EmptyState icon="inbox" title="No returns here" sub="Tap “Log a return” when something comes back." /></div> : (
        <div className="surface overflow-hidden">
          <div className="hidden lg:grid grid-cols-[1fr_190px_150px_120px] gap-3 px-5 py-2 bg-paper border-b border-rule text-[10.5px] uppercase tracking-[0.08em] font-semibold text-ink/50">
            <span>Return</span><span>How it came back</span><span>Order</span><span className="text-right">State</span>
          </div>
          {list.slice(0, 400).map(r => (
            <div key={r.id} role="button" tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(r.id) }} data-row="all"
              className={`relative grid grid-cols-1 lg:grid-cols-[1fr_190px_150px_120px] gap-x-3 gap-y-1.5 pl-5 pr-4 py-3 border-b border-rule last:border-0 cursor-pointer hover:bg-royal-50/60 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] ${{ red: 'before:bg-loss', amber: 'before:bg-warn', green: 'before:bg-gain', grey: 'before:bg-rule' }[returnTone(r)]}`}>
              <div className="flex items-center gap-3 min-w-0">
                <Thumb asin={asinOf(r.items?.[0]?.product_id)} size={44} count={qtyOf(r.items)} />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-ink leading-snug">{itemsText(r.items) || 'Products not set'}</div>
                  <div className="text-[12px] text-ink/55"><span className="font-mono">{r.ref}</span> · {fmtDate(r.received_at || r.created_at)}{r.received_by ? ` · ${r.received_by}` : ''}{r.delivered_by ? ` · ${r.delivered_by}` : ''}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 content-center">
                {(r.items || []).map((i, k) => <Chip key={k} tone={i.outcome === 'back_in_stock' || (!i.outcome && r.status === 'restocked') ? 'green' : i.outcome ? 'red' : 'plain'}>{i.qty} {OUTCOMES[i.outcome]?.short || 'not sorted'}</Chip>)}
                {(r.photos || []).length > 0 && <Chip icon="camera">{r.photos.length}</Chip>}
              </div>
              <div className="flex flex-col justify-center min-w-0">
                {r.order_ref ? <span className="font-mono text-[12px] text-ink truncate">{r.order_ref}</span> : <span className="text-[12px] text-warn font-semibold">Not matched</span>}
                <span className="text-[11px] text-ink/50">{[r.channel, REASONS[r.reason]].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="flex lg:flex-col lg:items-end justify-start lg:justify-center gap-1">
                <StatusBadge tone={RETURN_STATUS[r.status]?.tone}>{RETURN_STATUS[r.status]?.label || r.status}</StatusBadge>
                {r.needs_match ? <Flag tone="amber">To match</Flag> : r.rma ? <Chip tone="blue">Amazon</Chip> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── One return ───────────────────────────────────────────────────────────────────────────────────────────────────────
function ReturnDrawer({ r, ctx, me, showToast, onClose, onChanged, onClaim, onNavigate }) {
  const { data, asinOf, staff: office } = ctx
  const [busy, setBusy] = useState(false)
  const [finding, setFinding] = useState(false)
  const [sugg, setSugg] = useState(null)
  const a = r.rma ? data.amazon.find(x => x.rma === r.rma) : null
  const claims = data.claims.filter(c => c.return_id === r.id || (r.rma && c.rma === r.rma) || (r.order_ref && c.order_ref === r.order_ref && c.kind !== 'safet'))
  const safet = claims.find(c => c.kind === 'safet')
  const carrierClaim = claims.find(c => c.kind !== 'safet')
  const st = RETURN_STATUS[r.status] || RETURN_STATUS.received
  const save = async (patch, what) => { setBusy(true); try { const row = await saveCare('returns', r, patch, what, me?.name); onChanged(row); return row } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error') } finally { setBusy(false) } }
  // Suggestions for a box with no order: the products in it, the carrier, the quantity
  useEffect(() => {
    if (!office || !(r.needs_match || finding)) return
    const ids = [...new Set((r.items || []).map(i => i.product_id).filter(Boolean))]
    if (!ids.length) { setSugg([]); return }
    let live = true
    returnsSuggest(ids, r.delivered_by, qtyOf(r.items), r.id, r.received_at).then(s => { if (live) setSugg(s || []) }).catch(() => { if (live) setSugg([]) })
    return () => { live = false }
  }, [r.id, r.needs_match, finding, office]) // eslint-disable-line react-hooks/exhaustive-deps
  const link = async (o, how, score) => {
    const am = data.amazon.find(x => x.order_ref === o.order_ref && !x.return_id && (!o.rma || x.rma === o.rma))
    const row = await save({ order_ref: o.order_ref, ...(o.tracking ? { tracking: o.tracking } : {}), ...(o.carrier ? { carrier: o.carrier } : {}), channel: o.channel || (am ? 'Amazon' : r.channel),
      ...(am ? { rma: am.rma, amazon_reason: am.reason_code, reason: r.reason === 'to_check' ? am.reason : r.reason, expected_items: am.items } : {}),
      needs_match: false, matched_at: new Date().toISOString(), matched_by: me?.name || null, match_how: how, match_score: score ?? null,
      source: r.source === 'unknown' ? 'customer' : r.source }, `Matched to order ${o.order_ref}${am ? ` (Amazon return ${am.rma})` : ''}${how === 'suggestion' ? ` — suggested, ${score}% sure` : ''}`)
    if (row) { setFinding(false); showToast?.(`${r.ref} matched to ${o.order_ref}`) }
  }
  const startSafet = async () => {
    setBusy(true)
    try {
      const since = r.received_at || r.created_at
      const deadline = new Date(new Date(since).getTime() + SAFET_DAYS * 864e5).toISOString().slice(0, 10)
      const c = await addSafetClaim({ ret: r, amazon: a, deadline, by: me?.name })
      onClaim(c); await save({}, `SAFE-T claim ${c.ref} started — file it in Seller Central by ${fmtDate(deadline)}`)
      showToast?.(`${c.ref} added to Claims (SAFE-T)`)
    } catch (e) { showToast?.(/duplicate|unique/i.test(e?.message || '') ? 'This return already has a SAFE-T claim — see Claims' : e?.message || 'Couldn’t start it', 'error') } finally { setBusy(false) }
  }
  const startCarrier = async () => {
    setBusy(true)
    try {
      const c = await addClaim({ order_ref: r.order_ref, tracking: r.tracking, carrier: r.carrier, channel: r.channel, items: r.items || [], reason: r.reason === 'returned_to_sender' ? 'returned' : 'damaged', notes: `From return ${r.ref}`, kind: 'carrier', return_id: r.id }, me?.name)
      onClaim(c); showToast?.(`${c.ref} added to Claims`)
    } catch (e) { showToast?.(/duplicate|unique/i.test(e?.message || '') ? 'That parcel already has a claim — see Claims' : e?.message || 'Couldn’t start the claim', 'error') } finally { setBusy(false) }
  }
  const canSafet = office && safetEligible(r, a) && !safet && !a?.safet_claim_id
  const carrierCase = office && r.order_ref && !carrierClaim && (['damaged', 'returned_to_sender'].includes(r.reason) || r.source === 'carrier')
  const safetLeft = canSafet ? SAFET_DAYS - daysBetween(r.received_at || r.created_at, londonToday()) : null
  const matchText = r.match_how === 'suggestion' ? `a suggestion (${r.match_score}% sure)` : r.match_how === 'rma' ? 'the RMA' : r.match_how === 'tracking' ? 'the return label' : r.match_how === 'order' ? 'the order number' : r.match_how === 'expected' ? 'the Expected list' : r.match_how === 'delivered_date' ? 'Amazon’s delivered date (the only request that fits)' : r.match_how || null

  return (
    <Drawer title={r.ref} onClose={onClose} width="max-w-2xl" description={`${REASONS[r.reason] || r.reason} · ${r.source === 'carrier' ? 'from the carrier' : r.source === 'customer' ? 'from a customer' : 'sender not known yet'}`}>
      <div className="space-y-3">
        <div className={`rounded-card px-4 py-3.5 text-white ${r.needs_match ? 'bg-[#8A5A00]' : returnTone(r) === 'red' ? 'bg-loss' : returnTone(r) === 'green' ? 'bg-gain' : 'bg-ink'}`} data-drawer-band>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-white/80">{r.needs_match ? 'Order not found yet' : st.label}</div>
            {matchText && !r.needs_match && <span className="text-[11px] bg-white/20 rounded-[4px] px-2 py-0.5">Matched by {matchText}</span>}
          </div>
          <div className="text-[19px] font-bold leading-tight mt-1">{itemsText(r.items) || 'Products not set'}</div>
          <div className="text-[12.5px] text-white/85 mt-0.5">{(r.items || []).filter(i => i.outcome === 'back_in_stock').reduce((t, i) => t + (Number(i.qty) || 0), 0)} back in stock · {(r.items || []).filter(i => i.outcome && i.outcome !== 'back_in_stock').reduce((t, i) => t + (Number(i.qty) || 0), 0)} not resaleable</div>
        </div>

        <Section title="Details">
          <Facts items={[['Order', r.order_ref || '—', true], ['Channel', r.channel || '—'], ['Arrived', r.received_at ? fmtDate(r.received_at) : '—'], ['Logged by', r.received_by || '—'],
            ['Brought by', r.delivered_by || '—'], [isShopLabel(r.return_tracking) ? 'Evri shop label' : 'Scanned', r.return_tracking || '—', true], r.rma && ['Amazon RMA', r.rma, true], ['Cause', CAUSES[causeOf(r.reason)].label]]} />
          {r.notes && <div className="text-[13px] text-ink/70 mt-3 border-t border-rule pt-2.5">“{r.notes}”</div>}
          {r.order_ref && onNavigate && <button className="link-chip text-xs mt-3" onClick={() => onNavigate('order-audit', r.order_ref)}><Icon name="search" size={12} /> Order audit</button>}
        </Section>

        <Section title="In the box">
          <div className="space-y-2">{(r.items || []).map((i, k) => {
            const look = OUTCOME_LOOK[i.outcome] || (r.status === 'restocked' ? OUTCOME_LOOK.back_in_stock : null)
            return (
              <div key={k} className="flex items-center gap-3">
                <Thumb asin={asinOf(i.product_id) || a?.asin} size={44} count={i.qty} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink leading-snug">{i.name}</div>
                  <div className="text-[12px] text-ink/55">{i.qty} of {i.expected || i.qty}{i.expected && i.qty < i.expected ? <b className="text-loss"> — {i.expected - i.qty} missing</b> : ''}{i.location ? <> · shelf <span className="font-mono">{i.location}</span></> : ''}</div>
                </div>
                {look ? <span className={`inline-flex items-center gap-1 text-[11.5px] font-bold rounded-[6px] px-2 py-1 ${i.outcome === 'back_in_stock' || (!i.outcome && r.status === 'restocked') ? 'bg-gain/15 text-gain' : 'bg-loss/10 text-loss'}`}><Icon name={look.icon} size={12} />{OUTCOMES[i.outcome]?.short || 'Back in stock'}</span>
                  : <Chip>Not sorted</Chip>}
              </div>
            )
          })}</div>
        </Section>

        {a && (
          <Section title="Amazon return request" tone="sky" right={a.safet_claim_id ? <Flag tone={a.safet_state === 'GRANT' ? 'green' : a.safet_state === 'NOGRANT' ? 'red' : 'amber'}>SAFE-T {a.safet_state === 'GRANT' ? `granted ${money(a.safet_amount)}` : a.safet_state === 'NOGRANT' ? 'refused' : 'waiting on us'}</Flag> : null}>
            <div className="text-[14px] font-semibold">{REASONS[a.reason] || a.reason} <span className="text-xs text-ink/45 font-normal">({a.reason_code})</span></div>
            <Facts items={[['Requested', fmtDate(a.request_date)], ['Label', a.self_post ? 'Customer posted it' : `${carrierName(a.carrier)}${a.label_paid_by === 'Seller' && office ? ` · we paid ${money(a.label_cost)}` : ''}`],
              office && ['Order value', money(a.order_amount)], office && ['Refunded', a.refund_amount ? money(a.refund_amount) : 'not shown yet'], ['Resolution', a.resolution ? a.resolution.replace(/([A-Z])/g, ' $1').trim() : '—'], a.safet_claim_id && ['SAFE-T claim', a.safet_claim_id, true]]} />
          </Section>
        )}

        {office && (r.needs_match || finding || !r.order_ref) && (
          <Section title="Which order?" tone={r.needs_match ? 'coral' : undefined}>
            {isShopLabel(r.return_tracking) && <div className="mb-2.5"><Note>Evri shop label — this number is never in Amazon’s report. If the photos show Amazon’s slip, search its order number below; otherwise pick from the suggestions.</Note></div>}
            {sugg == null ? <Spinner /> : sugg.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[12px] text-ink/55">Suggested from Amazon’s requests (first those Amazon says were delivered back just before this box was logged), orders the carrier returned, refunds and open cases — best first.</div>
                {sugg.map(s => (
                  <div key={s.order_ref} className="rounded-[10px] border border-rule bg-white p-3 flex gap-3" data-suggestion>
                    <div className="shrink-0 w-12 text-center">
                      <div className={`text-[18px] font-bold tabular-nums ${s.score >= 75 ? 'text-gain' : s.score >= 50 ? 'text-warn' : 'text-ink/50'}`}>{s.score}%</div>
                      <div className="text-[9.5px] uppercase tracking-wide text-ink/45">sure</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[13px] font-semibold">{s.order_ref}</div>
                      <div className="text-[12.5px] text-ink/70">{itemsText(s.items || [])}{s.channel ? ` · ${s.channel}` : ''}</div>
                      <ul className="mt-1 space-y-0.5">{(s.reasons || []).map((x, k) => <li key={k} className="text-[12px] text-ink/60 flex gap-1.5"><span className="text-gain mt-[1px]"><Icon name="check" size={11} /></span>{x}</li>)}</ul>
                    </div>
                    <button className="btn btn-primary btn-sm self-center shrink-0" disabled={busy} onClick={() => link(s, 'suggestion', s.score)}>This is it</button>
                  </div>
                ))}
              </div>
            ) : <div className="text-[13px] text-ink/55">{(r.items || []).some(i => i.product_id) ? 'No likely orders found for these products.' : 'Add the products in the box to get suggestions.'}</div>}
            <div className="text-[12px] text-ink/55 pt-3">Or search by order, tracking, name or postcode:</div>
            <OrderFinder allowNames onPick={(o) => link(o, 'office')} />
          </Section>
        )}

        {office && (
          <Section title="Why it came back" right={r.order_ref && !r.needs_match && !finding ? <button className="btn btn-ghost btn-xs" onClick={() => setFinding(true)}>Change the order</button> : null}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="label">Who sent it back</label>
                <select className="input" value={r.source || 'unknown'} disabled={busy} onChange={e => save({ source: e.target.value }, `From: ${e.target.value}`)}>
                  <option value="unknown">Not known</option><option value="customer">The customer</option><option value="carrier">The carrier</option>
                </select></div>
              <div><label className="label">Reason</label>
                <select className="input" value={r.reason} disabled={busy} onChange={e => save({ reason: e.target.value }, `Reason: ${REASONS[e.target.value]}`)}>
                  {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
            </div>
          </Section>
        )}

        {office && (safet || carrierClaim || canSafet || carrierCase) && (
          <Section title="Claims" tone={canSafet ? 'coral' : undefined} right={canSafet ? <span className={`text-[12px] font-bold ${safetLeft <= 5 ? 'text-loss' : 'text-warn'}`}>{safetLeft} days to file</span> : null}>
            {safet && <div className="flex items-center justify-between gap-2 text-sm py-1"><span>SAFE-T <b>{safet.ref}</b> · {safet.status.replace(/_/g, ' ')}{safet.deadline ? ` · file by ${fmtDate(safet.deadline)}` : ''}</span>{onNavigate && <button className="btn btn-secondary btn-xs" onClick={() => onNavigate('claims', safet.id)}>Open</button>}</div>}
            {carrierClaim && <div className="flex items-center justify-between gap-2 text-sm py-1"><span>Carrier claim <b>{carrierClaim.ref}</b> · {carrierClaim.status.replace(/_/g, ' ')}</span>{onNavigate && <button className="btn btn-secondary btn-xs" onClick={() => onNavigate('claims', carrierClaim.id)}>Open</button>}</div>}
            {(canSafet || carrierCase) && <div className="flex flex-wrap gap-2 mt-1">
              {canSafet && <button className="btn btn-primary btn-sm" disabled={busy} onClick={startSafet}><Icon name="receipt" size={13} /> Start a SAFE-T claim</button>}
              {carrierCase && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={startCarrier}><Icon name="truck" size={13} /> Raise a carrier claim</button>}
            </div>}
            {canSafet && <div className="text-[12px] text-ink/55 mt-2">Amazon reimburses a seller for a return that came back damaged, used or not our item. The photos taken here are the evidence. File it in Seller Central within {SAFET_DAYS} days of it arriving.</div>}
          </Section>
        )}
        <Photos rec={r} table="returns" me={me} onChanged={onChanged} showToast={showToast} />
        <Section title="History"><Timeline list={r.history} /></Section>
      </div>
    </Drawer>
  )
}

/** An Amazon request (office): where it stands, and "It's arrived" if the box is in front of you */
function AmazonDrawer({ a, ctx, onClose, onArrived, onOpenReturn, onNavigate }) {
  const { today, staff: office } = ctx
  const state = amazonState(a, today), st = AMAZON_STATE[state]
  const age = ageOf(a.request_date, today)
  const band = { red: 'bg-loss', amber: 'bg-[#8A5A00]', blue: 'bg-royal-500', grey: 'bg-ink', green: 'bg-gain' }[st.tone]
  return (
    <Drawer title={`Amazon return · ${a.order_ref}`} onClose={onClose} width="max-w-2xl" description={`${REASONS[a.reason] || a.reason} · requested ${fmtDate(a.request_date)}`}>
      <div className="space-y-3">
        <div className={`rounded-card px-4 py-3.5 text-white flex items-center gap-3 ${band}`}>
          <Thumb asin={a.asin} size={56} count={a.qty} />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-white/80">{st.label}</div>
            <div className="text-[17px] font-bold leading-snug">{itemsText(a.items) || a.item_name}</div>
            <div className="text-[12.5px] text-white/85">{age} day{age === 1 ? '' : 's'} since the request{a.delivered_at ? ` · delivered back ${fmtDate(a.delivered_at)}` : ''}</div>
          </div>
        </div>
        {!a.return_id && <button className="w-full flex items-center justify-center gap-2 bg-royal-500 hover:bg-royal-600 text-white font-bold rounded-[10px] py-3.5" onClick={onArrived}><Icon name="inbox" size={16} /> It’s arrived — log it</button>}
        {a.return_id && <button className="btn btn-secondary btn-sm" onClick={() => onOpenReturn(a.return_id)}>Open the logged return</button>}
        <Section title="The request">
          <Facts items={[['Order', a.order_ref, true], ['RMA', a.rma, true], ['Customer’s reason', `${REASONS[a.reason] || a.reason}`], ['Cause', CAUSES[causeOf(a.reason)].label],
            ['Label', a.self_post ? 'Customer posts it (no tracking)' : `${carrierName(a.carrier)}${a.label_paid_by === 'Seller' && office ? ` · we paid ${money(a.label_cost)}` : a.label_paid_by === 'Customer' ? ' · customer paid' : ''}`],
            !a.self_post && ['Tracking', a.tracking, true], ['Listing SKU', a.sku, true], ['ASIN', a.asin, true], a.prime && ['Prime', 'Yes']]} />
          {onNavigate && <button className="link-chip text-xs mt-3" onClick={() => onNavigate('order-audit', a.order_ref)}><Icon name="search" size={12} /> Order audit</button>}
        </Section>
        {office && (
          <Section title="Money (from Amazon’s report)">
            <Facts items={[['Order value', money(a.order_amount)], ['Refunded', a.refund_amount ? money(a.refund_amount) : 'Not shown yet'], ['Resolution', a.resolution ? a.resolution.replace(/([A-Z])/g, ' $1').trim() : '—'],
              a.safet_claim_id && ['SAFE-T', `${a.safet_state}${a.safet_amount ? ` · ${money(a.safet_amount)}` : ''}`], a.safet_claim_id && ['SAFE-T claim', a.safet_claim_id, true]]} />
          </Section>
        )}
      </div>
    </Drawer>
  )
}

// ── Upload Amazon's returns report ───────────────────────────────────────────────────────────────────────────────────
function UploadPanel({ ctx, me, showToast, onDone }) {
  const { data, today } = ctx
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [log, setLog] = useState(null)
  const [over, setOver] = useState(false)
  const loadLog = useCallback(() => loadReturnsUploads().then(l => setLog(l || [])).catch(() => setLog([])), [])
  useEffect(() => { loadLog() }, [loadLog])
  const read = async (file) => {
    setError(null); setResult(null); setParsed(null)
    try { setParsed({ ...readReturnsReport(await file.text(), file.name), name: file.name }) } catch (e) { setError(e?.message || 'Couldn’t read the file') }
  }
  const run = async () => {
    setBusy(true); setError(null)
    try {
      // Sent in parts so a long history (months of returns) never times out
      let tot = { added: 0, updated: 0, linked: 0 }
      for (let i = 0; i < parsed.rows.length; i += 200) {
        const r = await uploadAmazonReturns(parsed.rows.slice(i, i + 200), parsed.name, me?.name)
        tot = { added: tot.added + (r?.added || 0), updated: tot.updated + (r?.updated || 0), linked: tot.linked + (r?.linked || 0) }
      }
      setResult(tot); setParsed(null); showToast?.(`Uploaded — ${tot.added} new, ${tot.updated} updated${tot.linked ? `, ${tot.linked} logged returns matched` : ''}`)
      loadLog(); onDone?.()
    } catch (e) { setError(e?.message || 'Couldn’t upload') } finally { setBusy(false) }
  }
  const last = log?.[0]
  const doneToday = last && String(last.uploaded_at).slice(0, 10) === today
  const dates = data.amazon.map(a => String(a.request_date).slice(0, 10)).sort()
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
      <div className="lg:col-span-7 space-y-3">
        <label onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) read(f) }}
          className={`block rounded-card border-2 border-dashed cursor-pointer px-6 py-10 text-center transition ${over ? 'border-royal-500 bg-royal-50' : 'border-royal-200 bg-white hover:border-royal-500 hover:bg-royal-50/50'}`} data-dropzone>
          <span className="mx-auto w-14 h-14 rounded-full bg-royal-500 text-white flex items-center justify-center"><Icon name="upload" size={24} /></span>
          <div className="text-[18px] font-bold mt-3">Drop Amazon’s returns report here</div>
          <div className="text-sm text-ink/55 mt-1">or tap to choose it · XML (quickest) or the text file</div>
          <input type="file" accept=".xml,.txt,.tsv,.csv,text/xml,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f) }} />
        </label>
        {error && <Note tone="red">{error}</Note>}
        {parsed && (
          <Section title="Ready to upload" tone="sky" right={<span className="text-[11px] text-ink/55">{parsed.format}</span>}>
            <div className="text-[14px] font-semibold break-all">{parsed.name}</div>
            <div className="text-[12.5px] text-ink/60">{parsed.from ? `Requests from ${fmtDate(parsed.from)} to ${fmtDate(parsed.to)}` : ''}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              {[['Requests', parsed.rows.length], ['Return label', parsed.rows.filter(r => r.tracking).length], ['Delivered back', parsed.rows.filter(r => r.delivered_at).length], ['SAFE-T', parsed.rows.filter(r => r.safet_claim_id).length]].map(([k, v]) => (
                <div key={k} className="bg-white border border-rule rounded-[8px] px-3 py-2"><div className="text-[20px] font-bold tabular-nums">{v}</div><div className="text-[11px] text-ink/55">{k}</div></div>
              ))}
            </div>
            {parsed.problems > 0 && <div className="text-xs text-warn mt-2">{parsed.problems} lines skipped (no RMA)</div>}
            <button className="btn btn-primary mt-3 w-full justify-center" disabled={busy} onClick={run}><Icon name="upload" size={14} /> {busy ? 'Uploading…' : `Upload ${parsed.rows.length} requests`}</button>
          </Section>
        )}
        {result && (
          <div className="rounded-card bg-gain text-white px-4 py-3.5 flex items-center gap-3">
            <Icon name="check" size={20} />
            <div><div className="font-bold">Uploaded</div><div className="text-[13px] text-white/90">{result.added} new · {result.updated} updated · {result.linked} logged returns matched to their orders</div></div>
          </div>
        )}
        <Section title="How to get it">
          <ol className="space-y-2">{[['Seller Central', 'Reports → Returns'], ['Choose the dates', 'the last 30 days is plenty for a daily upload'], ['Download', 'XML is quickest'], ['Drop it above', 'new requests go on Expected; anything already logged is matched']].map(([t, s], k) => (
            <li key={t} className="flex gap-3 items-start"><span className="w-6 h-6 rounded-full bg-royal-500 text-white text-[12px] font-bold flex items-center justify-center shrink-0">{k + 1}</span><span className="text-[13.5px]"><b>{t}</b> <span className="text-ink/55">— {s}</span></span></li>
          ))}</ol>
        </Section>
      </div>
      <div className="lg:col-span-5 space-y-3">
        <StatTile label="Today’s report" value={doneToday ? 'Uploaded' : 'Not yet'} tone={doneToday ? 'green' : 'amber'} sub={last ? `Last: ${fmtDate(last.uploaded_at)} by ${last.uploaded_by || 'someone'}` : 'Never uploaded'} />
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Requests held" value={data.amazon.length} sub="last 150 days" />
          <StatTile label="Covers" value={dates.length ? `${Math.max(1, daysBetween(dates[0], dates[dates.length - 1]))} days` : '—'} sub={dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : 'nothing yet'} />
        </div>
        <div className="surface overflow-hidden">
          <GroupHead tone="blue" title="Uploads" count={log?.length ?? null} />
          {!log ? <div className="p-4"><Spinner /></div> : !log.length ? <div className="px-4 py-5 text-sm text-ink/45">None yet.</div> : log.slice(0, 20).map(l => (
            <div key={l.id} className="px-4 py-2.5 border-b border-rule last:border-0">
              <div className="flex justify-between gap-3"><span className="text-[13px] font-semibold truncate">{l.file_name || 'Returns report'}</span><span className="text-[11px] text-ink/50 shrink-0">{fmtDate(l.uploaded_at)}</span></div>
              <div className="text-[11.5px] text-ink/55">{l.date_from ? `${fmtDate(l.date_from)} – ${fmtDate(l.date_to)} · ` : ''}{l.lines} lines · <b className="text-ink">{l.new_lines} new</b>{l.uploaded_by ? ` · ${l.uploaded_by}` : ''}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
